// Unit tests for BM25 keyword search and hybrid retrieval (no network)

const { createRagforge, createMemoryVectorStore, createBM25Index } = require('../../index');
const { tokenize } = require('../../src/eval/bm25');
const { createKeywordProvider, keywordVector } = require('./helpers');

// The test embedding sees only "what" and "does" in the query (it skips short
// tokens like E42), so vector search prefers the docs with those words. BM25 drops
// them as stopwords and finds the doc with the rare code.
const DOCS = [
  { id: 'logging.md', content: 'What does the log show? The log shows what the service does, and when it does it.' },
  { id: 'console.md', content: 'What does the console print? The console prints what the app does.' },
  { id: 'codes.md', content: 'Code E42 means the disk is full. Free some space on the volume and retry the upload.' },
  { id: 'pizza.md', content: 'Pizza dough is made from flour, water, yeast and salt.' },
];
const QUERY = 'What does E42 do?';
const QUESTION = { question: QUERY, expectedText: 'disk is full' };

function memoryStore() {
  const store = createMemoryVectorStore();
  store.add(DOCS.map((d) => ({ ...d, vector: keywordVector(d.content) })));
  return store;
}

const vectorOnly = (store) => ({ query: (v, k) => store.query(v, k) });

describe('BM25', () => {
  test('tokenize keeps identifiers whole and splits their parts', () => {
    expect(tokenize('Set maxTokens and max_tokens, not E42!')).toEqual(
      expect.arrayContaining(['set', 'maxtokens', 'max', 'tokens', 'max_tokens', 'e42'])
    );
    expect(tokenize('the and of')).toEqual([]);
  });

  test('ranks rare exact terms first and skips non-matches', () => {
    const index = createBM25Index();
    index.add(DOCS);

    const results = index.search(QUERY, 10);

    expect(results.map((r) => r.id)).toEqual(['codes.md']);
    expect(index.search('', 5)).toEqual([]);
    expect(index.size).toBe(4);
  });

  test('the memory vector store exposes keyword search', async () => {
    const [top] = await memoryStore().searchText('flour yeast', 1);
    expect(top.id).toBe('pizza.md');
  });
});

describe('evaluate: hybrid', () => {
  test('hybrid finds the exact-term chunk plain search misses, and is recommended at no LLM cost', async () => {
    const rf = createRagforge({ llm: createKeywordProvider(() => 'ok') });

    const result = await rf.evaluate({ documents: DOCS, questions: [QUESTION], techniques: ['baseline', 'hybrid'], topK: 2 });

    const row = (t) => result.results.find((r) => r.technique === t);
    expect(row('baseline').hitRate).toBe(0);
    expect(row('hybrid')).toMatchObject({ hitRate: 1, avgLlmCalls: 0 });
    expect(result.recommendation.technique).toBe('hybrid');
    expect(result.recommendation.reason).toMatch(/no extra LLM calls/);
  });

  test('hybrid is in the defaults for documents, and dropped for a store without searchText', async () => {
    const rf = createRagforge({ llm: createKeywordProvider(() => 'ok') });
    const withDocs = await rf.evaluate({ documents: DOCS, questions: [QUESTION], topK: 2, techniques: undefined });
    expect(withDocs.techniques).toContain('hybrid');

    rf.setVectorStore(vectorOnly(memoryStore()));
    const ownStore = await rf.evaluate({ questions: [QUESTION], topK: 2 });
    expect(ownStore.techniques).not.toContain('hybrid');
    await expect(rf.evaluate({ questions: [QUESTION], techniques: ['hybrid'] })).rejects.toThrow(/searchText/);
  });

  test('works against your own store when it has searchText', async () => {
    const rf = createRagforge({ llm: createKeywordProvider(() => 'ok'), vectorStore: memoryStore() });

    const result = await rf.evaluate({ questions: [{ question: QUERY, expectedId: 'codes.md' }], techniques: ['hybrid'], topK: 2 });

    expect(result.results[0].hitRate).toBe(1);
  });
});

describe('ragPipeline and auto: hybrid', () => {
  const codesText = DOCS[2].content;

  test('hybrid adds keyword results to the retrieved context', async () => {
    const rf = createRagforge({ llm: createKeywordProvider(() => 'answer'), vectorStore: memoryStore() });

    const plain = await rf.ragPipeline(QUERY, { techniques: [], topK: 2 });
    const hybrid = await rf.ragPipeline(QUERY, { techniques: [], topK: 2, hybrid: true });

    expect(plain.retrieved.slice(0, 2)).not.toContain(codesText);
    expect(hybrid.retrieved.slice(0, 2)).toContain(codesText);
  });

  test('the instance hybrid option is the default', async () => {
    const rf = createRagforge({ llm: createKeywordProvider(() => 'answer'), vectorStore: memoryStore(), hybrid: true });
    const res = await rf.ragPipeline(QUERY, { techniques: [], topK: 2 });
    expect(res.retrieved.slice(0, 2)).toContain(codesText);
  });

  test('explicit hybrid needs a store with searchText', async () => {
    const rf = createRagforge({ llm: createKeywordProvider(() => 'answer'), vectorStore: vectorOnly(memoryStore()) });
    await expect(rf.ragPipeline(QUERY, { hybrid: true })).rejects.toThrow(/searchText/);
  });

  const evalResult = {
    techniques: ['baseline', 'hybrid'],
    results: [
      { technique: 'baseline', avgLlmCalls: 0 },
      { technique: 'hybrid', avgLlmCalls: 0 },
    ],
    recommendation: { technique: 'hybrid', reason: '...' },
    questions: [QUERY, 'What does E17 do?', 'What does E99 do?'].map((question, i) => ({
      question,
      expectedId: 'x',
      runs: { baseline: { rank: i === 0 ? 1 : 0 }, hybrid: { rank: 1 } },
    })),
  };

  test('auto turns on keyword search when the eval picked hybrid', async () => {
    const rf = createRagforge({ llm: createKeywordProvider(() => 'answer'), vectorStore: memoryStore() });

    const res = await rf.auto(QUERY, { from: evalResult, topK: 2 });

    expect(res.route.technique).toBe('hybrid');
    expect(res.retrieved.slice(0, 2)).toContain(codesText);
  });

  test('a free technique wins its category without clearing minImprovement', async () => {
    const rf = createRagforge({ llm: createKeywordProvider(() => 'answer') });
    const r = await rf.route(QUERY, { from: evalResult, minImprovement: 0.9 });
    expect(r.technique).toBe('hybrid');
  });

  test('auto skips keyword search on a store without searchText and says so', async () => {
    const rf = createRagforge({ llm: createKeywordProvider(() => 'answer'), vectorStore: vectorOnly(memoryStore()) });

    const res = await rf.auto(QUERY, { from: evalResult, topK: 2 });

    expect(res.route.reason).toMatch(/Keyword search was skipped/);
    expect(res.retrieved.slice(0, 2)).not.toContain(codesText);
  });
});
