// Unit tests for rerankers and rerank techniques (no network)

const { createRagforge, createLLMReranker, createCohereReranker, createJinaReranker } = require('../../index');
const { createFakeProvider, createKeywordProvider } = require('./helpers');

const DOCS = [
  { id: 'cats.md', content: 'Cats are small domestic felines. Cats purr when content.' },
  { id: 'rockets.md', content: 'Rockets burn liquid fuel in engines to produce thrust.' },
  { id: 'pizza.md', content: 'Neapolitan pizza bakes in a very hot wood oven for ninety seconds.' },
];
// No word the test embedding sees overlaps any doc, so vector search keeps
// insertion order (cats first) and only the reranker can find the pizza doc
const QUESTION = { question: 'how long does it take', expectedText: 'ninety seconds' };

// Puts documents containing `needle` first, otherwise keeps the order
function createNeedleReranker(needle) {
  const calls = [];
  return {
    name: 'needle',
    model: null,
    calls,
    async rerank({ query, documents, topN }) {
      calls.push({ query, documents, topN });
      const order = documents.map((d, i) => i).sort((a, b) => documents[b].includes(needle) - documents[a].includes(needle));
      return { results: order.slice(0, topN).map((index, rank) => ({ index, score: 1 - rank / 10 })) };
    },
  };
}

function fakeFetch(body, { ok = true, status = 200 } = {}) {
  const calls = [];
  const fn = async (url, init) => {
    calls.push({ url, init, body: JSON.parse(init.body) });
    return { ok, status, json: async () => body, text: async () => JSON.stringify(body) };
  };
  fn.calls = calls;
  return fn;
}

describe('createLLMReranker', () => {
  test('parses the ranked numbers and appends passages the LLM left out', async () => {
    const chats = [];
    const chat = async (prompt, options) => {
      chats.push({ prompt, options });
      return '3, 1, 3, 9';
    };

    const { results } = await createLLMReranker().rerank({ query: 'q', documents: ['a', 'b', 'c'], topN: 3, chat });

    expect(results.map((r) => r.index)).toEqual([2, 0, 1]);
    expect(chats[0].options.temperature).toBe(0);
    expect(chats[0].prompt).toMatch(/\[3\] c/);
  });

  test('records one LLM call and one rerank call through the instance', async () => {
    const llm = createFakeProvider({ reply: (p) => (p.prompt.startsWith('Rank the passages') ? '2, 1' : 'answer') });
    const vectorStore = { query: async () => [{ content: 'first' }, { content: 'second' }] };
    const rf = createRagforge({ llm, vectorStore, reranker: 'llm' });

    const res = await rf.ragPipeline('q', { techniques: [], rerank: true });

    expect(res.retrieved).toEqual(['second', 'first']);
    expect(res.stats).toMatchObject({ rerankCalls: 1, llmCalls: 2 });
  });
});

describe('API rerankers', () => {
  test('Cohere sends the v2 request and its search cost is tracked', async () => {
    const fetch = fakeFetch({ results: [{ index: 1, relevance_score: 0.9 }, { index: 0, relevance_score: 0.1 }], meta: { billed_units: { search_units: 1 } } });
    const reranker = createCohereReranker({ apiKey: 'test-key', fetch });
    const llm = createFakeProvider({ free: true, reply: 'answer' });
    const rf = createRagforge({ llm, reranker, vectorStore: { query: async () => [{ content: 'a' }, { content: 'b' }] } });

    const res = await rf.ragPipeline('q', { techniques: [], rerank: true });

    expect(fetch.calls[0].url).toBe('https://api.cohere.com/v2/rerank');
    expect(fetch.calls[0].init.headers.Authorization).toBe('Bearer test-key');
    expect(fetch.calls[0].body).toEqual({ model: 'rerank-v3.5', query: 'q', documents: ['a', 'b'], top_n: 2 });
    expect(res.retrieved).toEqual(['b', 'a']);
    expect(res.stats.costUSD).toBeCloseTo(0.002, 6);
  });

  test('Jina sends its request and reports tokens', async () => {
    const fetch = fakeFetch({ results: [{ index: 0, relevance_score: 0.5 }], usage: { total_tokens: 42 } });
    const out = await createJinaReranker({ apiKey: 'k', fetch }).rerank({ query: 'q', documents: ['a', 'b'], topN: 1 });

    expect(fetch.calls[0].url).toBe('https://api.jina.ai/v1/rerank');
    expect(fetch.calls[0].body).toMatchObject({ model: 'jina-reranker-v2-base-multilingual', top_n: 1, return_documents: false });
    expect(out).toEqual({ results: [{ index: 0, score: 0.5 }], usage: { inputTokens: 42 } });
  });

  test('HTTP errors and missing keys fail clearly', async () => {
    const fetch = fakeFetch({ message: 'invalid api token' }, { ok: false, status: 401 });
    await expect(createCohereReranker({ apiKey: 'k', fetch }).rerank({ query: 'q', documents: ['a', 'b'] })).rejects.toThrow(/Cohere rerank failed \(401\)/);

    const saved = process.env.JINA_API_KEY;
    delete process.env.JINA_API_KEY;
    try {
      await expect(createJinaReranker({ fetch }).rerank({ query: 'q', documents: ['a', 'b'] })).rejects.toThrow(/JINA_API_KEY/);
    } finally {
      if (saved !== undefined) process.env.JINA_API_KEY = saved;
    }
  });

  test('unknown reranker names throw', () => {
    expect(() => createRagforge({ llm: createFakeProvider(), reranker: 'magic' })).toThrow(/Unknown reranker/);
  });
});

describe('evaluate: rerank', () => {
  test('rerank recovers a chunk plain search ranks too low', async () => {
    const reranker = createNeedleReranker('ninety seconds');
    const rf = createRagforge({ llm: createKeywordProvider(() => 'ok'), reranker });

    const result = await rf.evaluate({ documents: DOCS, questions: [QUESTION], techniques: ['baseline', 'rerank'], topK: 1 });

    const row = (t) => result.results.find((r) => r.technique === t);
    expect(row('baseline').hitRate).toBe(0);
    expect(row('rerank').hitRate).toBe(1);
    expect(result.recommendation.technique).toBe('rerank');
    expect(reranker.calls[0]).toMatchObject({ query: QUESTION.question, topN: 1 });
    expect(reranker.calls[0].documents).toHaveLength(3);
  });

  test('a reranker adds rerank techniques to the defaults; without one they throw', async () => {
    const withReranker = createRagforge({ llm: createKeywordProvider(() => 'ok'), reranker: createNeedleReranker('x') });
    const result = await withReranker.evaluate({ documents: DOCS, questions: [QUESTION], techniques: undefined });
    expect(result.techniques).toEqual(expect.arrayContaining(['rerank', 'hybrid+rerank']));

    const without = createRagforge({ llm: createKeywordProvider(() => 'ok') });
    await expect(without.evaluate({ documents: DOCS, questions: [QUESTION], techniques: ['rerank'] })).rejects.toThrow(/need a reranker/);
  });

  test('reranking has to clear minImprovement like the LLM techniques', async () => {
    // Puts the right chunk second: same hit@2 as baseline, better MRR
    const reranker = { name: 'r', model: null, rerank: async ({ documents }) => ({ results: [2, 0, 1].slice(0, documents.length).map((index) => ({ index, score: 1 })) }) };
    const rf = createRagforge({ llm: createKeywordProvider(() => 'ok'), reranker });

    const result = await rf.evaluate({ documents: DOCS, questions: [{ question: 'zzz', expectedText: 'small domestic' }], techniques: ['baseline', 'rerank'], topK: 2 });

    expect(result.recommendation.technique).toBe('baseline');
  });
});

describe('ragPipeline and auto: rerank', () => {
  function storeOf(texts) {
    const received = [];
    return { received, query: async (vector, topK) => (received.push(topK), texts.slice(0, topK).map((content) => ({ content }))) };
  }

  test('retrieves rerankK candidates and keeps the reranked order', async () => {
    const vectorStore = storeOf(['a', 'b', 'needle c', 'd']);
    const rf = createRagforge({ llm: createFakeProvider({ reply: 'answer' }), vectorStore, reranker: createNeedleReranker('needle') });

    const res = await rf.ragPipeline('q', { techniques: [], rerank: true, topK: 1, rerankK: 4 });

    expect(vectorStore.received).toEqual([4]);
    expect(res.retrieved[0]).toBe('needle c');
  });

  test('a failing reranker keeps retrieval order; rerank without a reranker throws', async () => {
    const failing = { name: 'down', model: null, rerank: async () => { throw new Error('503'); } };
    const rf = createRagforge({ llm: createFakeProvider({ reply: 'answer' }), vectorStore: storeOf(['a', 'b']), reranker: failing });
    expect((await rf.ragPipeline('q', { techniques: [], rerank: true })).retrieved).toEqual(['a', 'b']);

    const none = createRagforge({ llm: createFakeProvider(), vectorStore: storeOf(['a']) });
    await expect(none.ragPipeline('q', { rerank: true })).rejects.toThrow(/needs a reranker/);
  });

  const evalResult = {
    techniques: ['baseline', 'rerank'],
    results: [
      { technique: 'baseline', avgLlmCalls: 0 },
      { technique: 'rerank', avgLlmCalls: 0 },
    ],
    recommendation: { technique: 'rerank', reason: '...' },
    questions: ['refund policy', 'shipping times', 'warranty'].map((question) => ({
      question,
      expectedId: 'x',
      runs: { baseline: { rank: 0 }, rerank: { rank: 1 } },
    })),
  };

  test('auto reranks when the eval picked a rerank technique', async () => {
    const reranker = createNeedleReranker('needle');
    const rf = createRagforge({ llm: createFakeProvider({ reply: 'answer' }), vectorStore: storeOf(['a', 'needle b']), reranker });

    const res = await rf.auto('return window', { from: evalResult, topK: 1 });

    expect(res.route.technique).toBe('rerank');
    expect(res.retrieved[0]).toBe('needle b');
    expect(res.stats.rerankCalls).toBe(1);
  });

  test('auto skips reranking without a reranker and says so', async () => {
    const rf = createRagforge({ llm: createFakeProvider({ reply: 'answer' }), vectorStore: storeOf(['a', 'b']) });

    const res = await rf.auto('return window', { from: evalResult });

    expect(res.route.reason).toMatch(/Reranking was skipped/);
    expect(res.stats.rerankCalls).toBe(0);
  });
});
