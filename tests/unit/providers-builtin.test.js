// Unit tests for the Anthropic, Gemini, Mistral and Cohere adapters (fetch mocked, no network)

const { createAnthropicProvider, createGeminiProvider, createMistralProvider, createCohereProvider, createBuiltInProvider, supportsEmbeddings } = require('../../src/providers');
const { createRagforge } = require('../../index');
const { DEFAULT_PRICING, findPrice } = require('../../src/core/pricing');

describe('built-in provider registry', () => {
  test('creates each provider by name and knows which ones have embeddings', () => {
    for (const name of ['anthropic', 'gemini', 'mistral', 'cohere']) {
      expect(createBuiltInProvider(name, { apiKey: 'k' }).name).toBe(name);
    }
    expect(supportsEmbeddings('anthropic')).toBe(false);
    expect(supportsEmbeddings('gemini')).toBe(true);
    expect(supportsEmbeddings('mistral')).toBe(true);
    expect(supportsEmbeddings('cohere')).toBe(true);
  });

  test('unknown names list the available providers', () => {
    expect(() => createBuiltInProvider('nope')).toThrow(/Use one of: openai, ollama, anthropic, gemini, mistral, cohere, local/);
  });
});

describe('provider HTTP adapters', () => {
  const realFetch = global.fetch;
  const savedEnv = { ...process.env };
  afterEach(() => {
    global.fetch = realFetch;
    process.env = { ...savedEnv };
  });

  // Replies with `body` (or the given status) and records every request
  function mockFetch(body, { status = 200, text = '' } = {}) {
    const requests = [];
    global.fetch = jest.fn(async (url, init) => {
      requests.push({ url, headers: init.headers, body: JSON.parse(init.body) });
      return { ok: status < 400, status, text: async () => text || JSON.stringify(body), json: async () => body };
    });
    return requests;
  }

  describe('anthropic', () => {
    test('chat sends the messages API request and reads the text blocks and usage', async () => {
      const requests = mockFetch({
        model: 'claude-sonnet-4-6',
        content: [{ type: 'text', text: 'Hello ' }, { type: 'tool_use', id: 'x' }, { type: 'text', text: 'there' }],
        usage: { input_tokens: 20, output_tokens: 4 },
      });
      const provider = createAnthropicProvider({ apiKey: 'sk-ant-test' });

      const res = await provider.chat({ prompt: 'hi', model: 'claude-sonnet-4-6', temperature: 0 });

      expect(requests[0].url).toBe('https://api.anthropic.com/v1/messages');
      expect(requests[0].headers).toMatchObject({ 'x-api-key': 'sk-ant-test', 'anthropic-version': '2023-06-01' });
      expect(requests[0].body).toEqual({ model: 'claude-sonnet-4-6', max_tokens: 1024, temperature: 0, messages: [{ role: 'user', content: 'hi' }] });
      expect(res).toEqual({ text: 'Hello there', model: 'claude-sonnet-4-6', usage: { inputTokens: 20, outputTokens: 4 } });
    });

    test('reads ANTHROPIC_API_KEY from the environment when no key is passed', async () => {
      process.env.ANTHROPIC_API_KEY = 'from-env';
      const requests = mockFetch({ content: [], usage: {} });
      await createAnthropicProvider().chat({ prompt: 'p', model: 'claude-haiku-4-5' });
      expect(requests[0].headers['x-api-key']).toBe('from-env');
    });

    test('a missing key fails only when a call is made', async () => {
      delete process.env.ANTHROPIC_API_KEY;
      const provider = createAnthropicProvider();
      await expect(provider.chat({ prompt: 'p', model: 'claude-haiku-4-5' })).rejects.toThrow(/Missing ANTHROPIC_API_KEY/);
    });

    test('embed explains that Anthropic has no embeddings API', async () => {
      await expect(createAnthropicProvider({ apiKey: 'k' }).embed({ text: 'x' })).rejects.toThrow(/no embeddings API/);
    });

    test('HTTP errors include the status and the provider reply', async () => {
      mockFetch(null, { status: 401, text: '{"error":"invalid x-api-key"}' });
      await expect(createAnthropicProvider({ apiKey: 'bad' }).chat({ prompt: 'p', model: 'claude-haiku-4-5' })).rejects.toThrow(/Anthropic request failed: 401 .*invalid x-api-key/);
    });
  });

  describe('gemini', () => {
    test('chat calls generateContent with the key in a header, not the URL', async () => {
      const requests = mockFetch({
        modelVersion: 'gemini-2.5-flash-001',
        candidates: [{ content: { parts: [{ text: 'Answer' }] } }],
        usageMetadata: { promptTokenCount: 30, candidatesTokenCount: 7 },
      });
      const provider = createGeminiProvider({ apiKey: 'g-key' });

      const res = await provider.chat({ prompt: 'q', model: 'gemini-2.5-flash', temperature: 0.2, maxTokens: 100, topP: 1 });

      expect(requests[0].url).toBe('https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash:generateContent');
      expect(requests[0].url).not.toMatch(/key=/);
      expect(requests[0].headers['x-goog-api-key']).toBe('g-key');
      expect(requests[0].body).toEqual({
        contents: [{ role: 'user', parts: [{ text: 'q' }] }],
        generationConfig: { temperature: 0.2, maxOutputTokens: 100, topP: 1 },
      });
      expect(res).toEqual({ text: 'Answer', model: 'gemini-2.5-flash-001', usage: { inputTokens: 30, outputTokens: 7 } });
    });

    test('embed calls embedContent and returns the values', async () => {
      const requests = mockFetch({ embedding: { values: [0.1, 0.2] } });
      const res = await createGeminiProvider({ apiKey: 'g' }).embed({ text: 'doc', model: 'gemini-embedding-001' });
      expect(requests[0].url).toMatch(/models\/gemini-embedding-001:embedContent$/);
      expect(requests[0].body).toEqual({ content: { parts: [{ text: 'doc' }] } });
      expect(res.vector).toEqual([0.1, 0.2]);
    });

    test('GEMINI_API_KEY wins over GOOGLE_API_KEY, and GOOGLE_API_KEY is accepted alone', async () => {
      const requests = mockFetch({ candidates: [{ content: { parts: [] } }] });
      delete process.env.GEMINI_API_KEY;
      process.env.GOOGLE_API_KEY = 'google-only';
      await createGeminiProvider().chat({ prompt: 'p', model: 'gemini-2.5-flash' });
      process.env.GEMINI_API_KEY = 'gemini-first';
      await createGeminiProvider().chat({ prompt: 'p', model: 'gemini-2.5-flash' });
      expect(requests.map((r) => r.headers['x-goog-api-key'])).toEqual(['google-only', 'gemini-first']);
    });
  });

  describe('mistral', () => {
    test('chat uses the OpenAI-shaped endpoint with a bearer key', async () => {
      const requests = mockFetch({ model: 'mistral-small-latest', choices: [{ message: { content: 'Bonjour' } }], usage: { prompt_tokens: 9, completion_tokens: 2 } });
      const res = await createMistralProvider({ apiKey: 'm-key' }).chat({ prompt: 'hi', model: 'mistral-small-latest', temperature: 0, maxTokens: 20, topP: 1 });

      expect(requests[0].url).toBe('https://api.mistral.ai/v1/chat/completions');
      expect(requests[0].headers.Authorization).toBe('Bearer m-key');
      expect(requests[0].body).toEqual({ model: 'mistral-small-latest', messages: [{ role: 'user', content: 'hi' }], temperature: 0, max_tokens: 20, top_p: 1 });
      expect(res).toEqual({ text: 'Bonjour', model: 'mistral-small-latest', usage: { inputTokens: 9, outputTokens: 2 } });
    });

    test('embed returns the first vector', async () => {
      const requests = mockFetch({ data: [{ embedding: [0.5, 0.6] }], usage: { prompt_tokens: 3 } });
      const res = await createMistralProvider({ apiKey: 'm' }).embed({ text: 'doc', model: 'mistral-embed' });
      expect(requests[0].url).toBe('https://api.mistral.ai/v1/embeddings');
      expect(requests[0].body).toEqual({ model: 'mistral-embed', input: ['doc'] });
      expect(res).toEqual({ vector: [0.5, 0.6], model: 'mistral-embed', usage: { inputTokens: 3 } });
    });
  });

  describe('cohere', () => {
    test('chat uses v2 chat, joins text blocks and reads billed units', async () => {
      const requests = mockFetch({
        message: { content: [{ type: 'text', text: 'Hi' }, { type: 'text', text: '!' }] },
        usage: { billed_units: { input_tokens: 11, output_tokens: 3 }, tokens: { input_tokens: 12, output_tokens: 4 } },
      });
      const res = await createCohereProvider({ apiKey: 'c-key' }).chat({ prompt: 'hello', model: 'command-a-03-2025', temperature: 0.1, maxTokens: 50, topP: 0.9 });

      expect(requests[0].url).toBe('https://api.cohere.com/v2/chat');
      expect(requests[0].headers.Authorization).toBe('Bearer c-key');
      expect(requests[0].body).toEqual({ model: 'command-a-03-2025', messages: [{ role: 'user', content: 'hello' }], temperature: 0.1, max_tokens: 50, p: 0.9 });
      expect(res).toEqual({ text: 'Hi!', model: 'command-a-03-2025', usage: { inputTokens: 11, outputTokens: 3 } });
    });

    test('embed asks for float vectors for documents', async () => {
      const requests = mockFetch({ embeddings: { float: [[0.7, 0.8]] }, meta: { billed_units: { input_tokens: 4 } } });
      const res = await createCohereProvider({ apiKey: 'c' }).embed({ text: 'doc', model: 'embed-v4.0' });
      expect(requests[0].url).toBe('https://api.cohere.com/v2/embed');
      expect(requests[0].body).toEqual({ model: 'embed-v4.0', texts: ['doc'], input_type: 'search_document', embedding_types: ['float'] });
      expect(res).toEqual({ vector: [0.7, 0.8], model: 'embed-v4.0', usage: { inputTokens: 4 } });
    });
  });

  test('createRagforge accepts a provider name and uses it for chat', async () => {
    const requests = mockFetch({ content: [{ type: 'text', text: 'ok' }], usage: { input_tokens: 1, output_tokens: 1 } });
    process.env.ANTHROPIC_API_KEY = 'a';
    const rf = createRagforge({ llm: 'anthropic' });
    expect(rf.llm.name).toBe('anthropic');
    expect(await rf.callLLM('ping', { model: 'claude-haiku-4-5' })).toBe('ok');
    expect(requests[0].body.model).toBe('claude-haiku-4-5');
  });
});

describe('CLI with the new providers', () => {
  const { main } = require('../../src/cli');
  const { PassThrough } = require('stream');
  const fs = require('fs');
  const os = require('os');
  const path = require('path');
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'ragforge-prov-'));
  fs.mkdirSync(path.join(dir, 'docs'));
  fs.writeFileSync(path.join(dir, 'docs', 'a.md'), 'Quotas reset monthly for every team.');
  afterAll(() => fs.rmSync(dir, { recursive: true, force: true }));

  const capture = () => {
    let text = '';
    return { write: (s) => (text += s), get text() { return text; } };
  };

  test('eval with anthropic and no --embeddings explains what to pass', async () => {
    const stderr = capture();
    const code = await main(['eval', '--docs', 'docs', '--provider', 'anthropic'], { stdout: capture(), stderr, cwd: dir });
    expect(code).toBe(1);
    expect(stderr.text).toMatch(/anthropic has no embeddings API\. Pass --embeddings with one of: openai, ollama, gemini, mistral, cohere/);
  });

  test('mcp with anthropic and no --embeddings serves keyword search and says so', async () => {
    const stdin = new PassThrough();
    const stderr = capture();
    const pending = main(['mcp', '--docs', 'docs', '--provider', 'anthropic'], { stdout: capture(), stderr, cwd: dir, stdin });
    stdin.end();
    expect(await pending).toBe(0);
    expect(stderr.text).toMatch(/keyword search only/);
  });
});

describe('prices for the new providers', () => {
  test('known models resolve, including dated snapshots and the longest prefix', () => {
    expect(findPrice(DEFAULT_PRICING, 'claude-sonnet-4-6')).toEqual({ input: 3, output: 15 });
    expect(findPrice(DEFAULT_PRICING, 'claude-sonnet-4-6-20260101')).toEqual({ input: 3, output: 15 });
    expect(findPrice(DEFAULT_PRICING, 'gemini-2.5-flash-lite')).toEqual({ input: 0.1, output: 0.4 });
    expect(findPrice(DEFAULT_PRICING, 'gemini-2.5-flash-002')).toEqual({ input: 0.3, output: 2.5 });
    expect(findPrice(DEFAULT_PRICING, 'command-a-03-2025')).toEqual({ input: 2.5, output: 10 });
  });

  test('embedding models without a verified price report unknown cost instead of zero', async () => {
    const realFetch = global.fetch;
    global.fetch = jest.fn(async () => ({ ok: true, json: async () => ({ embedding: { values: [1] } }) }));
    try {
      const rf = createRagforge({ llm: createGeminiProvider({ apiKey: 'g' }) });
      let stats;
      await rf.getEmbedding('text', { model: 'gemini-embedding-001', onStats: (s) => (stats = s) });
      expect(stats.embeddingCalls).toBe(1);
      expect(stats.costUSD).toBeNull();
    } finally {
      global.fetch = realFetch;
    }
  });
});
