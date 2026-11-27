// Unit tests for contextual retrieval (roadmap 7.2), no network

const fs = require('fs');
const os = require('os');
const path = require('path');
const { createRagforge, createFileCache, createMemoryVectorStore, createBM25Index, chunkDocuments, formatTable, renderHtmlReport } = require('../../index');
const { documentWindow, cleanContext, CONTEXT_VERSION } = require('../../src/indexing/contextual');
const { recommend, rankRows } = require('../../src/eval/evaluate');
const { pipelineTechniques } = require('../../src/router/route');
const { indexDocuments } = require('../../src/chat');
const { buildIndex, searchIndex, startMcpServer } = require('../../src/mcp/server');
const { main } = require('../../src/cli');
const { createKeywordProvider, keywordVector } = require('./helpers');

// The refund passage never says "Acme" or "refund"; only its document does.
// An invoice passage does say "Acme", so plain search ranks it first.
const DOCS = [
  {
    id: 'acme-billing.md',
    content: [
      '# Acme Cloud billing',
      'Acme Cloud invoices are emailed monthly to the account owner.',
      'They take five business days to arrive after approval.',
    ].join('\n\n'),
  },
  { id: 'pets.md', content: 'Cats purr when content.\n\nDogs bark at strangers.' },
];
const SIZE = 70; // 4 chunks: the Acme heading, invoices, refunds, and both pet sentences

// Context lines name the document's subject; "refunds" only for the refund passage
function respond(prompt) {
  if (prompt.includes('<passage>')) {
    const passage = prompt.split('<passage>\n')[1].split('\n</passage>')[0];
    if (/five business days/.test(passage)) return 'Context: "From the Acme Cloud billing guide, the section on how long refunds take."';
    if (/Acme/.test(prompt.split('<passage>')[0])) return 'From the Acme Cloud billing guide.';
    return 'From a note about pets.';
  }
  if (prompt.includes('Passage:\n')) return 'How long do Acme refunds take?';
  return 'ok';
}

const tmpDirs = [];
function tmp() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'ragforge-ctx-'));
  tmpDirs.push(dir);
  return dir;
}
afterAll(() => tmpDirs.forEach((d) => fs.rmSync(d, { recursive: true, force: true })));

const contextCalls = (llm) => llm.calls.chat.filter((c) => c.prompt.includes('<passage>'));

describe('helpers', () => {
  test('documentWindow keeps short documents whole and cuts long ones around the chunk', () => {
    expect(documentWindow('short doc', 0.5, 100)).toBe('short doc');
    const text = Array.from({ length: 100 }, (_, i) => `w${String(i).padStart(2, '0')}`).join('');
    const start = documentWindow(text, 0, 40);
    expect(start.startsWith('w00')).toBe(true);
    expect(start.endsWith(' [...]')).toBe(true);
    const middle = documentWindow(text, 0.5, 40);
    expect(middle).toMatch(/^\[\.\.\.\] .*w5\d.* \[\.\.\.\]$/);
    expect(middle.replace(/\[\.\.\.\]/g, '').trim().length).toBe(40);
    expect(documentWindow(text, 1, 40).endsWith('w99')).toBe(true);
  });

  test('cleanContext strips labels and quotes, flattens and caps the line', () => {
    expect(cleanContext('Context:  "From the guide,\n about refunds."')).toBe('From the guide, about refunds.');
    expect(cleanContext('x'.repeat(900)).length).toBe(500);
    expect(cleanContext(undefined)).toBe('');
  });
});

describe('rf.contextualize', () => {
  test('adds a context line and indexText, leaves content as it was, and asks at temperature 0', async () => {
    const llm = createKeywordProvider(respond);
    const rf = createRagforge({ llm });
    const chunks = await chunkDocuments(DOCS, { size: SIZE });
    const result = await rf.contextualize(chunks, DOCS);

    const refund = result.chunks.find((c) => /five business days/.test(c.content));
    expect(refund.content).toBe('They take five business days to arrive after approval.');
    expect(refund.context).toBe('From the Acme Cloud billing guide, the section on how long refunds take.');
    expect(refund.indexText).toBe(`${refund.context}\n\n${refund.content}`);
    expect(result).toMatchObject({ cached: 0, failed: 0, errors: [] });
    expect(result.stats.llmCalls).toBe(chunks.length);

    const call = contextCalls(llm).find((c) => c.prompt.includes('five business days'));
    expect(call.temperature).toBe(0);
    // The whole document is shown with the chunk
    expect(call.prompt).toMatch(/<document>\n# Acme Cloud billing\n[\s\S]*<\/document>/);
  });

  test('uses its own model when given one', async () => {
    const llm = createKeywordProvider(respond);
    const rf = createRagforge({ llm });
    const chunks = await chunkDocuments(DOCS, { size: SIZE });
    const { estimate } = await rf.contextualize(chunks, DOCS, { model: 'gpt-4.1-nano' });
    expect(estimate.model).toBe('gpt-4.1-nano');
    expect(contextCalls(llm).every((c) => c.model === 'gpt-4.1-nano')).toBe(true);
  });

  test('estimates the cost up front from the price table', async () => {
    const rf = createRagforge({ llm: createKeywordProvider(respond) });
    const chunks = await chunkDocuments(DOCS, { size: SIZE });
    const e = await rf.estimateContextCost(chunks, DOCS);
    expect(e).toMatchObject({ chunks: chunks.length, cached: 0, calls: chunks.length, model: 'gpt-4o-mini' });
    expect(e.inputTokens).toBeGreaterThan(0);
    expect(e.outputTokens).toBe(chunks.length * 40);
    // gpt-4o-mini: $0.15 in, $0.60 out per 1M tokens
    expect(e.costUSD).toBeCloseTo((e.inputTokens * 0.15 + e.outputTokens * 0.6) / 1e6, 6);

    const unknown = createRagforge({ llm: { ...createKeywordProvider(respond), chatModel: 'mystery-model' } });
    expect((await unknown.estimateContextCost(chunks, DOCS)).costUSD).toBeNull();
    const free = createRagforge({ llm: { ...createKeywordProvider(respond), chatModel: 'llama3', free: true } });
    expect((await free.estimateContextCost(chunks, DOCS)).costUSD).toBe(0);
  });

  test('a budget below the estimate stops it before any LLM call; an unknown price can not be checked', async () => {
    const llm = createKeywordProvider(respond);
    const rf = createRagforge({ llm });
    const chunks = await chunkDocuments(DOCS, { size: SIZE });
    await expect(rf.contextualize(chunks, DOCS, { budgetUSD: 0 })).rejects.toThrow(/would cost about \$0\.\d{4} \(4 LLM calls with gpt-4o-mini\), over the budget of \$0/);
    expect(llm.calls.chat).toHaveLength(0);

    const mystery = createKeywordProvider(respond);
    const rf2 = createRagforge({ llm: { ...mystery, chatModel: 'mystery-model' } });
    await expect(rf2.contextualize(chunks, DOCS, { budgetUSD: 1 })).rejects.toThrow(/no price known for mystery-model/);
    expect(mystery.calls.chat).toHaveLength(0);

    await expect(rf.contextualize(chunks, DOCS, { budgetUSD: -1 })).rejects.toThrow(/budgetUSD must be a number/);
    // A generous budget goes ahead
    const ok = await rf.contextualize(chunks, DOCS, { budgetUSD: 1 });
    expect(ok.failed).toBe(0);
  });

  test('cached lines cost nothing: a file cache carries them to the next run', async () => {
    const file = path.join(tmp(), 'nested', 'context-cache.json');
    const chunks = await chunkDocuments(DOCS, { size: SIZE });

    const first = createKeywordProvider(respond);
    const run1 = await createRagforge({ llm: first }).contextualize(chunks, DOCS, { cache: createFileCache(file) });
    expect(contextCalls(first)).toHaveLength(chunks.length);
    expect(fs.existsSync(file)).toBe(true);
    const saved = JSON.parse(fs.readFileSync(file, 'utf8'));
    expect(Object.keys(saved).every((k) => k.startsWith(`context:v${CONTEXT_VERSION}:gpt-4o-mini:`))).toBe(true);

    const second = createKeywordProvider(respond);
    const rf2 = createRagforge({ llm: second });
    const cache = createFileCache(file);
    const estimate = await rf2.estimateContextCost(chunks, DOCS, { cache });
    expect(estimate).toMatchObject({ cached: chunks.length, calls: 0, costUSD: 0 });
    const run2 = await rf2.contextualize(chunks, DOCS, { cache, budgetUSD: 0 });
    expect(second.calls.chat).toHaveLength(0);
    expect(run2.cached).toBe(chunks.length);
    expect(run2.stats.cacheHits).toBe(chunks.length);
    expect(run2.chunks.map((c) => c.indexText)).toEqual(run1.chunks.map((c) => c.indexText));

    // Another model writes its own lines
    const other = await rf2.estimateContextCost(chunks, DOCS, { cache, model: 'gpt-4.1-nano' });
    expect(other.cached).toBe(0);
  });

  test('a failed call leaves that chunk without context; every call failing is an error', async () => {
    const flaky = createKeywordProvider((p) => {
      if (p.includes('<passage>') && p.includes('Dogs bark')) throw new Error('rate limited');
      return respond(p);
    });
    const chunks = await chunkDocuments(DOCS, { size: SIZE });
    const result = await createRagforge({ llm: flaky }).contextualize(chunks, DOCS);
    expect(result.failed).toBe(1);
    expect(result.errors[0]).toEqual({ id: 'pets.md#1', error: 'rate limited' });
    const dogs = result.chunks.find((c) => c.id === 'pets.md#1');
    expect(dogs).toMatchObject({ context: '', indexText: dogs.content });

    const down = createKeywordProvider(() => {
      throw new Error('service down');
    });
    await expect(createRagforge({ llm: down }).contextualize(chunks, DOCS)).rejects.toThrow(/failed for every chunk: service down/);
  });

  test('rejects chunks from other documents and providers without a chat model', async () => {
    const rf = createRagforge({ llm: createKeywordProvider(respond) });
    const chunks = await chunkDocuments(DOCS, { size: SIZE });
    await expect(rf.contextualize(chunks, [DOCS[1]])).rejects.toThrow(/belongs to document "acme-billing.md", which is not in documents/);
    const embedOnly = createRagforge({ llm: { ...createKeywordProvider(respond), name: 'local', chatModel: null } });
    await expect(embedOnly.contextualize(chunks, DOCS)).rejects.toThrow(/needs a chat model, and the local provider has none/);
  });
});

describe('indexText in the keyword and vector stores', () => {
  test('search matches indexText but returns content', async () => {
    const bm25 = createBM25Index();
    bm25.add([{ id: 'a', content: 'They take five days.', indexText: 'Acme refunds. They take five days.' }]);
    expect(bm25.search('acme refunds', 1)).toEqual([expect.objectContaining({ id: 'a', content: 'They take five days.' })]);

    const store = createMemoryVectorStore();
    store.add([{ id: 'a', content: 'They take five days.', indexText: 'Acme refunds. They take five days.', vector: [1, 0] }]);
    const [hit] = await store.searchText('acme', 1);
    expect(hit).toMatchObject({ id: 'a', content: 'They take five days.' });
    const [v] = await store.query([1, 0], 1);
    expect(v).not.toHaveProperty('indexText');
    expect(v.content).toBe('They take five days.');
  });
});

describe('evaluate with contextual techniques', () => {
  const QUESTIONS = [{ question: 'How long do Acme refunds take?', expectedText: 'five business days' }];

  test('contextual finds the passage plain search misses, and its index cost is reported apart', async () => {
    const llm = createKeywordProvider(respond);
    const rf = createRagforge({ llm });
    const result = await rf.evaluate({
      documents: DOCS,
      questions: QUESTIONS,
      techniques: ['baseline', 'hybrid', 'contextual', 'contextual+hybrid'],
      chunkSize: SIZE,
      topK: 1,
    });
    const row = (t) => result.results.find((r) => r.technique === t);
    expect(row('baseline').hitRate).toBe(0);
    expect(row('contextual').hitRate).toBe(1);
    expect(row('contextual+hybrid').hitRate).toBe(1);
    // No LLM calls at query time: the context was written at index time
    expect(row('contextual').avgLlmCalls).toBe(0);
    expect(result.recommendation.technique).toMatch(/^contextual/);

    expect(result.contextual).toMatchObject({ model: 'gpt-4o-mini', chunks: 4, contextualized: 4, cached: 0, failed: 0 });
    // One call per chunk, plus the contextual chunks' embeddings
    expect(result.contextual.usage).toMatchObject({ llmCalls: 4, embeddingCalls: 4 });
    expect(result.setup.llmCalls).toBe(0);
    expect(formatTable(result)).toMatch(/Contextual: 4 of 4 chunks given context by gpt-4o-mini, one-time index cost \$/);
    expect(renderHtmlReport(result)).toMatch(/Contextual index cost: \$[\d.]+ \(one-time\)/);
    // Retrieved passages are shown as written, without the context line
    expect(result.questions[0].runs.contextual.retrieved).toEqual(['acme-billing.md#3']);
  });

  test('contextual: true adds contextual and contextual+hybrid to the defaults; contextOptions reach the writer', async () => {
    const llm = createKeywordProvider(respond);
    const estimates = [];
    const result = await createRagforge({ llm }).evaluate({
      documents: DOCS,
      questions: QUESTIONS,
      contextual: true,
      contextOptions: { model: 'gpt-4.1-nano', onEstimate: (e) => estimates.push(e) },
      chunkSize: SIZE,
    });
    expect(result.techniques).toEqual(['baseline', 'hybrid', 'hyde', 'stepback', 'fanout', 'contextual', 'contextual+hybrid']);
    expect(estimates).toHaveLength(1);
    expect(estimates[0].model).toBe('gpt-4.1-nano');
    expect(result.contextual.model).toBe('gpt-4.1-nano');
  });

  test('no context lines are written when no technique needs them', async () => {
    const llm = createKeywordProvider(respond);
    const result = await createRagforge({ llm }).evaluate({ documents: DOCS, questions: QUESTIONS, techniques: ['baseline'], chunkSize: SIZE });
    expect(contextCalls(llm)).toHaveLength(0);
    expect(result.contextual).toBeUndefined();
  });

  test('is checked before spending: needs documents, a chat model, a contextual technique and the budget', async () => {
    const llm = createKeywordProvider(respond);
    const rf = createRagforge({ llm, vectorStore: createMemoryVectorStore() });
    await expect(rf.evaluate({ questions: QUESTIONS, techniques: ['contextual'] })).rejects.toThrow(/need `documents`.*rf\.contextualize/);
    await expect(rf.evaluate({ documents: DOCS, questions: QUESTIONS, contextual: true, techniques: ['baseline'] })).rejects.toThrow(/lists none/);
    await expect(rf.evaluate({ documents: DOCS, questions: QUESTIONS, techniques: ['contextual'], chunkSize: SIZE, contextOptions: { budgetUSD: 0 } })).rejects.toThrow(/over the budget/);
    const noChat = createRagforge({ llm: { ...createKeywordProvider(respond), name: 'local', chatModel: null } });
    await expect(noChat.evaluate({ documents: DOCS, questions: QUESTIONS, techniques: ['contextual'] })).rejects.toThrow(/need a chat model to write context lines/);
    expect(llm.calls.chat).toHaveLength(0);
    expect(llm.calls.embed).toHaveLength(0);
  });

  test('contextual counts as costly: a small gain over plain search is not enough', () => {
    const row = (technique, hitRate) => ({ technique, hitRate, mrr: hitRate, avgLatencyMs: 1, avgCostUSD: 0.000001, avgLlmCalls: 0 });
    const pick = recommend(rankRows([row('baseline', 0.8), row('contextual', 0.83)]), 5, 0.05);
    expect(pick.technique).toBe('baseline');
    expect(pick.reason).toMatch(/not enough to justify its extra cost/);
    expect(recommend(rankRows([row('baseline', 0.7), row('contextual', 0.8)]), 5, 0.05).technique).toBe('contextual');
  });
});

describe('routing', () => {
  test('contextual is an indexing choice, so the pipeline runs no technique for it', () => {
    expect(pipelineTechniques('contextual')).toEqual([]);
    expect(pipelineTechniques('contextual+hybrid+hyde')).toEqual(['hyde']);
  });

  test('auto() from an eval that picked contextual says to index with contextualize', async () => {
    const llm = createKeywordProvider(respond);
    const rf = createRagforge({ llm });
    const evalResult = await rf.evaluate({ documents: DOCS, questions: QUESTIONS_FOR_ROUTE, techniques: ['baseline', 'contextual'], chunkSize: SIZE, topK: 1 });
    const chunks = (await rf.contextualize(await chunkDocuments(DOCS, { size: SIZE }), DOCS)).chunks;
    const store = createMemoryVectorStore();
    store.add(chunks.map((c) => ({ id: c.id, content: c.content, indexText: c.indexText, vector: keywordVector(c.indexText) })));
    rf.setVectorStore(store);
    const result = await rf.auto('How long do Acme refunds take?', { from: evalResult, topK: 1 });
    expect(result.route.technique).toBe('contextual');
    expect(result.route.reason).toMatch(/build it from rf\.contextualize\(\) chunks/);
    expect(result.sources[0].content).toBe('They take five business days to arrive after approval.');
  });
});
const QUESTIONS_FOR_ROUTE = [{ question: 'How long do Acme refunds take?', expectedText: 'five business days' }];

describe('chat and MCP indexing', () => {
  test('chat: indexDocuments with contextual searches the context but shows the passage', async () => {
    const llm = createKeywordProvider(respond);
    const rf = createRagforge({ llm });
    const estimates = [];
    const { count, contextual } = await indexDocuments(rf, DOCS, { chunkSize: SIZE, contextual: true, contextOptions: { onEstimate: (e) => estimates.push(e) } });
    expect(count).toBe(4);
    expect(contextual).toMatchObject({ failed: 0, cached: 0 });
    expect(estimates).toHaveLength(1);
    const result = await rf.ragPipeline('How long do Acme refunds take?', { techniques: [], hybrid: true, topK: 1 });
    expect(result.sources[0].content).toBe('They take five business days to arrive after approval.');
  });

  test('MCP: search_docs finds passages by their context line', async () => {
    const llm = createKeywordProvider(respond);
    const index = await buildIndex(DOCS, { chunkSize: SIZE, embedder: null, concurrency: 2, contextualizer: createRagforge({ llm }) });
    const [hit] = await searchIndex(index, 'Acme refunds', 1);
    expect(hit.id).toBe('acme-billing.md#3');
    expect(hit.content).toBe('They take five business days to arrive after approval.');
    expect(index.context.failed).toBe(0);
  });

  test('MCP: contextual without a chat model is refused before serving', async () => {
    await expect(startMcpServer({ documents: DOCS, contextual: true })).rejects.toThrow(/contextual retrieval needs a chat model/);
  });
});

describe('createFileCache', () => {
  test('starts empty on a missing or damaged file and saves on flush', async () => {
    const dir = tmp();
    const file = path.join(dir, 'c.json');
    fs.writeFileSync(file, '{ not json');
    const cache = createFileCache(file);
    expect(cache.size).toBe(0);
    await cache.set('k', 'v');
    expect(await cache.get('k')).toBe('v');
    await cache.flush();
    expect(JSON.parse(fs.readFileSync(file, 'utf8'))).toEqual({ k: 'v' });
    expect(await createFileCache(file).get('k')).toBe('v');
    expect(await createFileCache(path.join(dir, 'missing.json')).get('k')).toBeUndefined();
  });
});

describe('CLI', () => {
  function io() {
    let out = '';
    let err = '';
    return {
      stdout: { write: (s) => (out += s) },
      stderr: { write: (s) => (err += s) },
      get out() {
        return out;
      },
      get err() {
        return err;
      },
    };
  }

  function setup() {
    const dir = tmp();
    fs.mkdirSync(path.join(dir, 'docs'));
    DOCS.forEach((d) => fs.writeFileSync(path.join(dir, 'docs', d.id), d.content));
    fs.writeFileSync(path.join(dir, 'q.json'), JSON.stringify(QUESTIONS_FOR_ROUTE));
    let llm;
    const factory = (opts) => {
      llm = createKeywordProvider(respond);
      return createRagforge({ ...opts, llm, embeddings: llm });
    };
    return { dir, factory, llm: () => llm };
  }

  test('--context-* options need --contextual, and the budget must be dollars', async () => {
    const { dir, factory } = setup();
    const a = io();
    expect(await main(['eval', '--docs', 'docs', '--context-budget', '1'], { ...a, cwd: dir, createRagforge: factory })).toBe(1);
    expect(a.err).toMatch(/--context-budget needs --contextual/);
    const b = io();
    expect(await main(['eval', '--docs', 'docs', '--contextual', '--context-budget', 'lots'], { ...b, cwd: dir, createRagforge: factory })).toBe(1);
    expect(b.err).toMatch(/--context-budget must be an amount in US dollars/);
    const c = io();
    expect(await main(['mcp', '--docs', 'docs', '--contextual'], { ...c, cwd: dir })).toBe(1);
    expect(c.err).toMatch(/--contextual needs a chat model/);
  });

  test('eval --contextual prints the estimate first, caches the lines, and the second run is free', async () => {
    const { dir, factory, llm } = setup();
    const args = ['eval', '--docs', 'docs', '--questions-file', 'q.json', '--techniques', 'baseline,contextual', '--chunk-size', String(SIZE), '--top-k', '1'];

    const first = io();
    expect(await main(args, { ...first, cwd: dir, createRagforge: factory })).toBe(0);
    expect(first.err).toMatch(/Contextual retrieval: 4 chunks, 4 LLM calls with gpt-4o-mini, estimated \$0\.\d{4}\./);
    expect(first.err.indexOf('Contextual retrieval:')).toBeLessThan(first.err.indexOf('Writing context lines'));
    expect(first.out).toMatch(/contextual ★/);
    expect(first.out).toMatch(/Contextual: 4 of 4 chunks given context/);
    const cacheFile = path.join(dir, '.ragforge', 'context-cache.json');
    expect(Object.keys(JSON.parse(fs.readFileSync(cacheFile, 'utf8')))).toHaveLength(4);

    const second = io();
    expect(await main([...args, '--context-budget', '0'], { ...second, cwd: dir, createRagforge: factory })).toBe(0);
    expect(second.err).toMatch(/Contextual retrieval: 4 chunks, 4 cached, 0 LLM calls with gpt-4o-mini, nothing to pay\./);
    expect(contextCalls(llm())).toHaveLength(0);
    expect(second.out).toMatch(/4 from cache/);

    // --context-cache none skips the cache, so the budget now stops it
    const third = io();
    expect(await main([...args, '--context-budget', '0', '--context-cache', 'none'], { ...third, cwd: dir, createRagforge: factory })).toBe(1);
    expect(third.err).toMatch(/over the budget of \$0/);
  });

  test('chat --contextual reports the context cost when indexing', async () => {
    const { dir, factory } = setup();
    const { PassThrough } = require('stream');
    const stdin = new PassThrough();
    stdin.end('exit\n');
    const a = io();
    expect(await main(['chat', '--docs', 'docs', '--contextual', '--chunk-size', String(SIZE)], { ...a, stdin, cwd: dir, createRagforge: factory })).toBe(0);
    expect(a.err).toMatch(/Contextual retrieval: 4 chunks, 4 LLM calls/);
    expect(a.err).toMatch(/Indexed 4 passages from 2 document\(s\) with openai, with context lines: cost (\$0\.\d{4}|<\$0\.0001)\. Ask/);
  });
});
