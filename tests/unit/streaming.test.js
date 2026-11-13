// Unit tests for streaming answers (no network): the pipeline, the call context,
// and each provider's stream parser with the HTTP or SDK call mocked

const { createRagforge } = require('../../index');
const { createMemoryVectorStore } = require('../../src/eval/memoryVectorStore');
const { createOpenAIProvider } = require('../../src/providers/openai');
const { createOllamaProvider } = require('../../src/providers/ollama');
const { createAnthropicProvider } = require('../../src/providers/anthropic');
const { createKeywordProvider, keywordVector } = require('./helpers');

const PASSAGES = [
  { id: 'refunds.md#1', content: 'Refunds go back to the original card within five business days.' },
  { id: 'shipping.md#1', content: 'Orders ship from the Berlin warehouse on weekdays.' },
];

// A keyword provider that can also stream: yields the answer in pieces and reports usage at the end
function streamingProvider(pieces, { failAfter = null } = {}) {
  const base = createKeywordProvider(() => 'Plan the answer.');
  return {
    ...base,
    async *chatStream(params) {
      for (let i = 0; i < pieces.length; i++) {
        if (failAfter !== null && i === failAfter) throw new Error('connection dropped');
        yield pieces[i];
      }
      return { model: params.model, usage: { inputTokens: 40, outputTokens: 6 } };
    },
  };
}

function storeWithPassages() {
  const store = createMemoryVectorStore();
  store.add(PASSAGES.map((p) => ({ ...p, vector: keywordVector(p.content) })));
  return store;
}

describe('pipeline streaming', () => {
  test('auto with stream: sources are ready before the first token, tokens arrive in order, answer and stats settle at the end', async () => {
    const pieces = ['Refunds take ', 'five days [1].'];
    const llm = streamingProvider(pieces);
    const rf = createRagforge({ llm, embeddings: llm, vectorStore: storeWithPassages() });
    let statsSeen = null;

    const result = await rf.auto('refunds original card', { stream: true, topK: 2, onStats: (s) => (statsSeen = s) });

    // Sources and the route are known before the stream is read
    expect(result.sources.length).toBeGreaterThan(0);
    expect(result.sources.map((x) => x.id)).toContain('refunds.md#1');
    expect(result.route.technique).toBeDefined();
    expect(statsSeen).toBeNull();

    const tokens = [];
    for await (const token of result.stream) tokens.push(token);

    expect(tokens).toEqual([...pieces]);
    await expect(result.answer).resolves.toBe('Refunds take five days [1].');
    await expect(result.citations).resolves.toEqual([1]);
    expect(result.sources.find((x) => x.ref === 1).cited).toBe(true);

    const stats = await result.stats;
    expect(stats.llmCalls).toBeGreaterThanOrEqual(2);
    // Includes the streamed answer (6 tokens) plus the keyword stub's routing calls
    expect(stats.outputTokens).toBeGreaterThanOrEqual(6);
    // onStats runs once, when the stream has ended
    expect(statsSeen).toEqual(stats);
  });

  test('providers without chatStream still work: the whole answer comes out as one chunk', async () => {
    const llm = createKeywordProvider((prompt) => (prompt.includes('Context passages') ? 'Five days [1].' : 'Plan.'));
    const rf = createRagforge({ llm, embeddings: llm, vectorStore: storeWithPassages() });

    const result = await rf.ragPipeline('refund time', { stream: true, techniques: [], topK: 1 });
    const chunks = [];
    for await (const chunk of result.stream) chunks.push(chunk);

    expect(chunks).toEqual(['Five days [1].']);
    await expect(result.answer).resolves.toBe('Five days [1].');
  });

  test('a stream that fails rejects the stream, answer and stats, and is logged', async () => {
    const llm = streamingProvider(['Partial ', 'never'], { failAfter: 1 });
    const errors = [];
    const rf = createRagforge({ llm, embeddings: llm, vectorStore: storeWithPassages(), logger: { error: (m) => errors.push(m) } });

    const result = await rf.auto('refund time', { stream: true, topK: 1 });
    const read = (async () => {
      for await (const _ of result.stream) {
        // consume until the failure
      }
    })();

    await expect(read).rejects.toThrow('connection dropped');
    await expect(result.answer).rejects.toThrow('connection dropped');
    await expect(result.stats).rejects.toThrow('connection dropped');
    expect(errors.join(' ')).toMatch(/LLM stream failed: connection dropped/);
  });

  test('a stream nobody reads leaves no unhandled rejection behind', async () => {
    const llm = streamingProvider(['x'], { failAfter: 0 });
    const rf = createRagforge({ llm, embeddings: llm, vectorStore: storeWithPassages() });
    // Creating the result is enough; the failure only happens when the stream is read
    const result = await rf.auto('refund time', { stream: true, topK: 1 });
    expect(result.stream).toBeDefined();
  });
});

describe('provider stream parsers', () => {
  const realFetch = global.fetch;
  afterEach(() => {
    global.fetch = realFetch;
  });

  // A body that delivers the given text in uneven pieces, so lines get split across chunks
  function bodyOf(text, size = 7) {
    const bytes = Buffer.from(text);
    return (async function* () {
      for (let i = 0; i < bytes.length; i += size) yield bytes.subarray(i, i + size);
    })();
  }

  async function collect(gen) {
    const tokens = [];
    let step;
    while (!(step = await gen.next()).done) tokens.push(step.value);
    return { tokens, meta: step.value };
  }

  test('openai: yields content deltas and reads usage from the last chunk', async () => {
    const chunks = [
      { model: 'gpt-4o-mini', choices: [{ delta: { content: 'Hel' } }] },
      { model: 'gpt-4o-mini', choices: [{ delta: { content: 'lo' } }] },
      { model: 'gpt-4o-mini', choices: [{ delta: {} }], usage: { prompt_tokens: 12, completion_tokens: 2 } },
    ];
    const requests = [];
    const provider = createOpenAIProvider({
      client: {
        chat: {
          completions: {
            create: async (params) => {
              requests.push(params);
              return (async function* () { yield* chunks; })();
            },
          },
        },
      },
    });

    const { tokens, meta } = await collect(provider.chatStream({ prompt: 'hi', model: 'gpt-4o-mini', temperature: 0 }));

    expect(requests[0]).toMatchObject({ stream: true, stream_options: { include_usage: true } });
    expect(tokens).toEqual(['Hel', 'lo']);
    expect(meta).toEqual({ model: 'gpt-4o-mini', usage: { inputTokens: 12, outputTokens: 2 } });
  });

  test('ollama: reads NDJSON lines split across chunks and takes usage from the done line', async () => {
    const lines = [
      { model: 'llama3.1', message: { content: 'Hi' }, done: false },
      { model: 'llama3.1', message: { content: ' there' }, done: false },
      { model: 'llama3.1', message: { content: '' }, done: true, prompt_eval_count: 9, eval_count: 2 },
    ].map((l) => JSON.stringify(l)).join('\n') + '\n';
    global.fetch = jest.fn(async (url, init) => {
      expect(url).toBe('http://localhost:11434/api/chat');
      expect(JSON.parse(init.body).stream).toBe(true);
      return { ok: true, body: bodyOf(lines) };
    });

    const { tokens, meta } = await collect(createOllamaProvider().chatStream({ prompt: 'hi', model: 'llama3.1' }));

    expect(tokens).toEqual(['Hi', ' there']);
    expect(meta).toEqual({ model: 'llama3.1', usage: { inputTokens: 9, outputTokens: 2 } });
  });

  test('anthropic: yields text deltas from SSE events and sums usage across events', async () => {
    const events = [
      { type: 'message_start', message: { model: 'claude-sonnet-4-6', usage: { input_tokens: 30, output_tokens: 1 } } },
      { type: 'content_block_start', index: 0, content_block: { type: 'text', text: '' } },
      { type: 'content_block_delta', index: 0, delta: { type: 'text_delta', text: 'Refunds ' } },
      { type: 'content_block_delta', index: 0, delta: { type: 'text_delta', text: 'take five days.' } },
      { type: 'message_delta', delta: { stop_reason: 'end_turn' }, usage: { output_tokens: 5 } },
      { type: 'message_stop' },
    ];
    const sse = events.map((e) => `event: ${e.type}\ndata: ${JSON.stringify(e)}\n\n`).join('');
    global.fetch = jest.fn(async (url, init) => {
      expect(url).toBe('https://api.anthropic.com/v1/messages');
      expect(JSON.parse(init.body).stream).toBe(true);
      return { ok: true, body: bodyOf(sse, 11) };
    });

    const { tokens, meta } = await collect(createAnthropicProvider({ apiKey: 'k' }).chatStream({ prompt: 'q', model: 'claude-sonnet-4-6' }));

    expect(tokens).toEqual(['Refunds ', 'take five days.']);
    expect(meta).toEqual({ model: 'claude-sonnet-4-6', usage: { inputTokens: 30, outputTokens: 5 } });
  });

  test('anthropic: an error event in the stream is raised', async () => {
    const sse = `data: ${JSON.stringify({ type: 'error', error: { type: 'overloaded_error', message: 'Overloaded' } })}\n\n`;
    global.fetch = jest.fn(async () => ({ ok: true, body: bodyOf(sse) }));
    await expect(collect(createAnthropicProvider({ apiKey: 'k' }).chatStream({ prompt: 'q', model: 'claude-sonnet-4-6' }))).rejects.toThrow(/Overloaded/);
  });

  test('a failed HTTP status is raised before any token', async () => {
    global.fetch = jest.fn(async () => ({ ok: false, status: 429, text: async () => 'rate limited' }));
    await expect(collect(createOllamaProvider().chatStream({ prompt: 'q', model: 'llama3.1' }))).rejects.toThrow(/Ollama request failed: 429 rate limited/);
  });
});
