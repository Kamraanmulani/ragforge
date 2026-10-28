// Unit tests for createRagforge (no network)

const { createRagforge, createMemoryCache } = require('../../index');
const { createFakeProvider } = require('./helpers');

describe('createRagforge: LLM options', () => {
  test('forwards options and respects temperature 0', async () => {
    const llm = createFakeProvider();
    const rf = createRagforge({ llm });

    await rf.cot('q', { temperature: 0, model: 'custom-model', max_tokens: 42 });

    expect(llm.calls.chat[0]).toMatchObject({ temperature: 0, model: 'custom-model', maxTokens: 42 });
  });

  test('accepts camelCase options too', async () => {
    const llm = createFakeProvider();
    const rf = createRagforge({ llm });

    await rf.callLLM('hi', { maxTokens: 7, topP: 0.5 });

    expect(llm.calls.chat[0]).toMatchObject({ maxTokens: 7, topP: 0.5 });
  });

  test('uses provider chat model unless defaults.model is set', async () => {
    const llm = createFakeProvider({ chatModel: 'provider-model' });
    await createRagforge({ llm }).callLLM('hi');
    await createRagforge({ llm, defaults: { model: 'default-model' } }).callLLM('hi');

    expect(llm.calls.chat.map((c) => c.model)).toEqual(['provider-model', 'default-model']);
  });

  test('stepback keeps its own defaults but user options override', async () => {
    const llm = createFakeProvider();
    await createRagforge({ llm }).stepback('q', { max_tokens: 42 });

    expect(llm.calls.chat).toHaveLength(2);
    llm.calls.chat.forEach((c) => expect(c).toMatchObject({ maxTokens: 42, temperature: 0.3 }));
  });
});

describe('createRagforge: stats', () => {
  test('ragPipeline returns calls, tokens and cost', async () => {
    const llm = createFakeProvider({ chatModel: 'gpt-4o-mini' });
    const rf = createRagforge({ llm });

    const { stats } = await rf.ragPipeline('q', { techniques: ['cot'] });

    // cot + final synthesis, 1000 in / 500 out each at $0.15 / $0.60 per 1M
    expect(stats.llmCalls).toBe(2);
    expect(stats.embeddingCalls).toBe(0);
    expect(stats.inputTokens).toBe(2000);
    expect(stats.outputTokens).toBe(1000);
    expect(stats.costUSD).toBeCloseTo((2000 * 0.15 + 1000 * 0.6) / 1e6, 10);
    expect(stats.latencyMs).toBeGreaterThanOrEqual(0);
  });

  test('dated model snapshots match the longest price prefix', async () => {
    const llm = createFakeProvider();
    const stats = [];
    await createRagforge({ llm }).callLLM('hi', { model: 'gpt-4o-mini-2024-07-18', onStats: (s) => stats.push(s) });

    expect(stats[0].costUSD).toBeCloseTo((1000 * 0.15 + 500 * 0.6) / 1e6, 10);
  });

  test('unknown model gives null cost, custom pricing fixes it', async () => {
    const llm = createFakeProvider({ chatModel: 'mystery-model' });
    let a, b;
    await createRagforge({ llm }).callLLM('hi', { onStats: (s) => (a = s) });
    await createRagforge({ llm, pricing: { 'mystery-model': { input: 1, output: 2 } } })
      .callLLM('hi', { onStats: (s) => (b = s) });

    expect(a.costUSD).toBeNull();
    expect(b.costUSD).toBeCloseTo((1000 * 1 + 500 * 2) / 1e6, 10);
  });

  test('free providers cost 0', async () => {
    const llm = createFakeProvider({ free: true, chatModel: 'llama3.1' });
    const { stats } = await createRagforge({ llm }).ragPipeline('q', { techniques: ['cot'] });

    expect(stats.costUSD).toBe(0);
  });

  test('stats are isolated between concurrent calls', async () => {
    const llm = createFakeProvider({ delayMs: 10 });
    const rf = createRagforge({ llm });

    const [a, b] = await Promise.all([
      rf.ragPipeline('a', { techniques: ['cot'] }),
      rf.ragPipeline('b', { techniques: ['cot', 'stepback'] }),
    ]);

    expect(a.stats.llmCalls).toBe(2);
    expect(b.stats.llmCalls).toBe(4);
  });
});

describe('createRagforge: cache', () => {
  test('repeat calls hit the cache and cost nothing', async () => {
    const llm = createFakeProvider();
    const rf = createRagforge({ llm, cache: true });

    await rf.callLLM('same prompt');
    let stats;
    await rf.callLLM('same prompt', { onStats: (s) => (stats = s) });

    expect(llm.calls.chat).toHaveLength(1);
    expect(stats).toMatchObject({ llmCalls: 0, cacheHits: 1, costUSD: 0 });
  });

  test('different options are cached separately', async () => {
    const llm = createFakeProvider();
    const rf = createRagforge({ llm, cache: true });

    await rf.callLLM('p', { temperature: 0 });
    await rf.callLLM('p', { temperature: 1 });

    expect(llm.calls.chat).toHaveLength(2);
  });

  test('accepts a custom cache adapter', async () => {
    const store = new Map();
    const cache = { get: async (k) => store.get(k), set: async (k, v) => void store.set(k, v) };
    const llm = createFakeProvider();
    const rf = createRagforge({ llm, cache });

    await rf.getEmbedding('text');
    await rf.getEmbedding('text');

    expect(llm.calls.embed).toHaveLength(1);
    expect(store.size).toBe(1);
  });

  test('memory cache evicts least recently used entries', async () => {
    const cache = createMemoryCache({ maxEntries: 2 });
    await cache.set('a', 1);
    await cache.set('b', 2);
    await cache.get('a'); // a is now most recent
    await cache.set('c', 3);

    expect(await cache.get('b')).toBeUndefined();
    expect(await cache.get('a')).toBe(1);
    expect(cache.size).toBe(2);
  });
});

describe('createRagforge: retrieval', () => {
  test('without a vector store no embeddings are made', async () => {
    const llm = createFakeProvider();
    await createRagforge({ llm }).ragPipeline('q', { techniques: ['hyde', 'cot', 'fanout'] });

    expect(llm.calls.embed).toHaveLength(0);
  });

  test('vector store always receives embedding vectors', async () => {
    const llm = createFakeProvider();
    const received = [];
    const vectorStore = {
      query: async (vector, topK) => {
        received.push({ vector, topK });
        return [{ content: 'doc-A', score: 1 }];
      },
    };
    const rf = createRagforge({ llm, vectorStore });

    const res = await rf.ragPipeline('q', { techniques: ['cot'], topK: 4 });

    expect(received.length).toBeGreaterThan(0);
    received.forEach((r) => expect(Array.isArray(r.vector)).toBe(true));
    expect(received.find((r) => r.topK === 4)).toBeDefined();
    expect(res.retrieved).toEqual(['doc-A']);
  });

  test('techniqueOptions and finalModelOptions are routed separately', async () => {
    const llm = createFakeProvider();
    await createRagforge({ llm }).ragPipeline('q', {
      techniques: ['cot'],
      techniqueOptions: { model: 'tech-model' },
      finalModelOptions: { model: 'final-model' },
    });

    expect(llm.calls.chat.map((c) => c.model)).toEqual(['tech-model', 'final-model']);
  });

  test('techniques run in parallel', async () => {
    const llm = createFakeProvider({ delayMs: 20 });
    await createRagforge({ llm }).translate('q', { techniques: ['hyde', 'cot', 'stepback'] });

    expect(llm.maxInFlight).toBeGreaterThanOrEqual(3);
  });

  test('unknown technique names throw', async () => {
    const rf = createRagforge({ llm: createFakeProvider() });

    await expect(rf.translate('q', { techniques: ['hide'] })).rejects.toThrow(/Unknown technique/);
  });

  test('one failing technique does not fail the pipeline', async () => {
    const llm = createFakeProvider({
      reply: (p) => {
        if (p.prompt.startsWith('Think step by step')) throw new Error('boom');
        return 'ok';
      },
    });
    const res = await createRagforge({ llm }).ragPipeline('q', { techniques: ['cot', 'hyde'] });

    expect(res.translation.cot).toBeNull();
    expect(res.translation.hyde).toBe('ok');
    expect(res.answer).toBe('ok');
  });
});

describe('createRagforge: logging', () => {
  test('silent by default, custom logger receives messages', async () => {
    const spy = jest.spyOn(console, 'log').mockImplementation(() => {});
    const messages = [];
    await createRagforge({ llm: createFakeProvider() }).hyde('q');
    await createRagforge({ llm: createFakeProvider(), logger: { info: (m) => messages.push(m) } }).hyde('q');

    expect(spy).not.toHaveBeenCalled();
    expect(messages.length).toBeGreaterThan(0);
    spy.mockRestore();
  });
});
