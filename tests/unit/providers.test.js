// Unit tests for provider adapters and the v1 API (no network)

const ragforge = require('../../index');
const { createRagforge, createOllamaProvider, createOpenAIProvider } = ragforge;

describe('Ollama provider', () => {
  const realFetch = global.fetch;
  afterEach(() => {
    global.fetch = realFetch;
  });

  function mockFetch(body) {
    const requests = [];
    global.fetch = jest.fn(async (url, init) => {
      requests.push({ url, body: JSON.parse(init.body) });
      return { ok: true, json: async () => body };
    });
    return requests;
  }

  test('chat maps options and usage', async () => {
    const requests = mockFetch({ model: 'llama3.1', message: { content: 'hi' }, prompt_eval_count: 12, eval_count: 3 });
    const provider = createOllamaProvider({ baseURL: 'http://box:11434/' });

    const res = await provider.chat({ prompt: 'p', model: 'llama3.1', temperature: 0, maxTokens: 50 });

    expect(requests[0].url).toBe('http://box:11434/api/chat');
    expect(requests[0].body).toMatchObject({ model: 'llama3.1', stream: false, options: { temperature: 0, num_predict: 50 } });
    expect(res).toEqual({ text: 'hi', model: 'llama3.1', usage: { inputTokens: 12, outputTokens: 3 } });
  });

  test('embed returns the first vector', async () => {
    mockFetch({ model: 'nomic-embed-text', embeddings: [[1, 2, 3]], prompt_eval_count: 4 });
    const res = await createOllamaProvider().embed({ text: 't', model: 'nomic-embed-text' });

    expect(res.vector).toEqual([1, 2, 3]);
  });

  test('HTTP errors are raised with the response text', async () => {
    global.fetch = jest.fn(async () => ({ ok: false, status: 404, text: async () => 'model not found' }));

    await expect(createOllamaProvider().chat({ prompt: 'p', model: 'x' })).rejects.toThrow(/404 model not found/);
  });

  test('createRagforge({ llm: "ollama" }) reports zero cost', async () => {
    mockFetch({ message: { content: 'ok' }, prompt_eval_count: 10, eval_count: 10 });
    let stats;
    await createRagforge({ llm: 'ollama' }).callLLM('hi', { onStats: (s) => (stats = s) });

    expect(stats).toMatchObject({ llmCalls: 1, costUSD: 0, inputTokens: 10 });
  });
});

describe('OpenAI provider', () => {
  function fakeClient() {
    const calls = [];
    return {
      calls,
      chat: {
        completions: {
          create: async (p) => {
            calls.push(p);
            return { model: 'gpt-4o-mini-2024-07-18', choices: [{ message: { content: 'ok' } }], usage: { prompt_tokens: 5, completion_tokens: 2 } };
          },
        },
      },
      embeddings: { create: async () => ({ data: [{ embedding: [0.5] }], usage: { prompt_tokens: 3 } }) },
    };
  }

  test('maps params to the Chat Completions API', async () => {
    const client = fakeClient();
    const res = await createOpenAIProvider({ client }).chat({ prompt: 'p', model: 'gpt-4o-mini', maxTokens: 9, temperature: 0 });

    expect(client.calls[0]).toMatchObject({ model: 'gpt-4o-mini', max_tokens: 9, temperature: 0, messages: [{ role: 'user', content: 'p' }] });
    expect(res).toEqual({ text: 'ok', model: 'gpt-4o-mini-2024-07-18', usage: { inputTokens: 5, outputTokens: 2 } });
  });

  test('defaults to gpt-4o-mini and ada-002 embeddings', () => {
    const p = createOpenAIProvider();
    expect(p.chatModel).toBe('gpt-4o-mini');
    expect(p.embeddingModel).toBe('text-embedding-ada-002');
  });

  test('missing API key throws on first call, not at creation', async () => {
    const saved = process.env.OPENAI_API_KEY;
    delete process.env.OPENAI_API_KEY;
    const rf = createRagforge();

    await expect(rf.callLLM('hi')).rejects.toThrow(/Missing OPENAI_API_KEY/);
    if (saved !== undefined) process.env.OPENAI_API_KEY = saved;
  });
});

describe('v1 API compatibility', () => {
  test('exports the v1 functions', () => {
    for (const fn of ['hyde', 'cot', 'stepback', 'fanout', 'ragPipeline', 'rrf', 'setVectorClient', 'callLLM', 'getEmbedding', 'setOpenAIClient']) {
      expect(typeof ragforge[fn]).toBe('function');
    }
  });

  test('setOpenAIClient + setVectorClient drive the default instance', async () => {
    const chats = [];
    ragforge.setOpenAIClient({
      chat: { completions: { create: async (p) => (chats.push(p), { choices: [{ message: { content: 'ans' } }] }) } },
      embeddings: { create: async () => ({ data: [{ embedding: [1, 2] }] }) },
    });
    const vectors = [];
    ragforge.setVectorClient({ query: async (v) => (vectors.push(v), [{ content: 'doc' }]) });

    const res = await ragforge.ragPipeline('q', { techniques: ['cot'] });
    const vec = await ragforge.getEmbedding('t', 'text-embedding-3-small');

    expect(res.retrieved).toEqual(['doc']);
    expect(vectors.every(Array.isArray)).toBe(true);
    expect(vec).toEqual([1, 2]);
    ragforge.setVectorClient(null);
  });
});
