// Unit tests for local embeddings (no model download, no network): the transformers
// package is replaced by a fake pipeline, and the MCP and CLI paths run with --embeddings local

const { createLocalProvider, DEFAULT_LOCAL_MODEL } = require('../../src/providers/local');
const { createBuiltInProvider, supportsEmbeddings } = require('../../src/providers');
const { createRagforge } = require('../../index');
const { keywordVector } = require('./helpers');

// Fake @huggingface/transformers: `pipeline` returns an extractor that embeds text with keywordVector
function fakeTransformers(calls = []) {
  return {
    pipeline: async (task, model, options) => {
      calls.push({ task, model, options });
      return async (text, opts) => {
        calls.push({ text, opts });
        return { data: Float32Array.from(keywordVector(text, 16)) };
      };
    },
  };
}

describe('local embedding provider', () => {
  test('is registered as a free embeddings provider with no chat model', () => {
    const provider = createBuiltInProvider('local');
    expect(provider.name).toBe('local');
    expect(provider.free).toBe(true);
    expect(provider.chatModel).toBeNull();
    expect(provider.embeddingModel).toBe(DEFAULT_LOCAL_MODEL);
    expect(supportsEmbeddings('local')).toBe(true);
  });

  test('embed loads the pipeline once and returns a plain number array', async () => {
    const calls = [];
    const provider = createLocalProvider({ importer: async () => fakeTransformers(calls) });

    const a = await provider.embed({ text: 'refund policy', model: DEFAULT_LOCAL_MODEL });
    const b = await provider.embed({ text: 'shipping times' });

    expect(a.vector).toHaveLength(16);
    expect(Array.isArray(a.vector)).toBe(true);
    expect(b.model).toBe(DEFAULT_LOCAL_MODEL);
    // One pipeline creation for two embeddings
    expect(calls.filter((c) => c.task === 'feature-extraction')).toHaveLength(1);
    expect(calls.find((c) => c.task)).toMatchObject({ task: 'feature-extraction', model: DEFAULT_LOCAL_MODEL, options: { dtype: 'fp32' } });
    expect(calls.filter((c) => c.text)[0].opts).toEqual({ pooling: 'mean', normalize: true });
  });

  test('a missing package gives an install hint, and the next call retries', async () => {
    let attempts = 0;
    const importer = async () => {
      attempts++;
      if (attempts === 1) throw Object.assign(new Error("Cannot find package"), { code: 'ERR_MODULE_NOT_FOUND' });
      return fakeTransformers();
    };
    const provider = createLocalProvider({ importer });

    await expect(provider.embed({ text: 'x' })).rejects.toThrow(/npm install @huggingface\/transformers/);
    await expect(provider.embed({ text: 'x' })).resolves.toMatchObject({ vector: expect.any(Array) });
    expect(attempts).toBe(2);
  });

  test('other import errors are passed through unchanged', async () => {
    const provider = createLocalProvider({ importer: async () => { throw new Error('boom'); } });
    await expect(provider.embed({ text: 'x' })).rejects.toThrow('boom');
  });

  test('chat explains that the local provider has no chat model', async () => {
    await expect(createLocalProvider().chat({ prompt: 'hi' })).rejects.toThrow(/no chat model/);
  });

  test('createRagforge with local embeddings and a keyword-only search still works end to end', async () => {
    const rf = createRagforge({
      llm: { name: 'stub', chatModel: 'x', embeddingModel: null, free: true, chat: async () => ({ text: 'ok', usage: {} }), embed: async () => { throw new Error('unused'); } },
      embeddings: createLocalProvider({ importer: async () => fakeTransformers() }),
    });
    const vector = await rf.getEmbedding('hello');
    expect(vector).toHaveLength(16);
    expect(rf.embedder.name).toBe('local');
  });
});
