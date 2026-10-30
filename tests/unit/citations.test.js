// Unit tests for numbered sources and citations in ragPipeline/auto (no network)

const { createRagforge } = require('../../index');
const { citedRefs } = require('../../src/pipeline/ragPipeline');
const { createFakeProvider } = require('./helpers');

const RESULTS = [
  { id: 'billing.md#3', content: 'Annual plans are refunded pro rata.', score: 0.82, metadata: { page: 3 } },
  { id: 'billing.md#4', content: 'Refunds take 5 business days.', score: 0.71 },
  'A plain string result.',
];

function setup(reply) {
  const llm = createFakeProvider({ reply });
  const vectorStore = { query: async (vector, topK) => RESULTS.slice(0, topK) };
  return { llm, rf: createRagforge({ llm, vectorStore }) };
}

const finalPrompt = (llm) => llm.calls.chat[llm.calls.chat.length - 1].prompt;

describe('citedRefs', () => {
  test('reads single, adjacent, listed and ranged markers, ignoring unknown numbers', () => {
    expect(citedRefs('A [2]. B [1][3]. C [1, 4]. D [2-3]. E [9]. Year [2026].', 4)).toEqual([1, 2, 3, 4]);
    expect(citedRefs('No markers here.', 3)).toEqual([]);
  });
});

describe('ragPipeline: citations', () => {
  test('numbers the passages in the prompt and returns them as sources', async () => {
    const { llm, rf } = setup('Refunds are pro rata [1] and take a week [2]. See also [7].');

    const res = await rf.ragPipeline('How do refunds work?', { techniques: [], topK: 3 });

    expect(finalPrompt(llm)).toMatch(/\[1\] Annual plans are refunded pro rata\.\n\n\[2\] Refunds take 5 business days\./);
    expect(finalPrompt(llm)).toMatch(/Cite the passages you use/);
    expect(res.citations).toEqual([1, 2]);
    expect(res.sources).toEqual([
      { ref: 1, id: 'billing.md#3', content: 'Annual plans are refunded pro rata.', score: 0.82, metadata: { page: 3 }, cited: true },
      { ref: 2, id: 'billing.md#4', content: 'Refunds take 5 business days.', score: 0.71, metadata: null, cited: true },
      { ref: 3, id: null, content: 'A plain string result.', score: null, metadata: null, cited: false },
    ]);
  });

  test('sources follow topK and the merged order across searches', async () => {
    const { rf } = setup('ok');
    const res = await rf.ragPipeline('q', { techniques: ['fanout'], topK: 2 });

    expect(res.sources.map((s) => s.ref)).toEqual([1, 2]);
    expect(res.sources.map((s) => s.content)).toEqual(res.retrieved.slice(0, 2));
  });

  test('citations: false leaves the instructions out', async () => {
    const { llm, rf } = setup('Pro rata [1].');
    const res = await rf.ragPipeline('q', { techniques: [], citations: false });

    expect(finalPrompt(llm)).not.toMatch(/Cite the passages/);
    expect(res.citations).toEqual([]);
    expect(res.sources.every((s) => s.cited === false)).toBe(true);
  });

  test('without a vector store there is nothing to cite', async () => {
    const llm = createFakeProvider({ reply: 'General answer [1].' });
    const res = await createRagforge({ llm }).ragPipeline('q', { techniques: ['hyde'] });

    expect(res.sources).toEqual([]);
    expect(res.citations).toEqual([]);
    expect(finalPrompt(llm)).not.toMatch(/Cite the passages/);
  });

  test('auto returns sources too', async () => {
    const { rf } = setup('Pro rata [1].');
    const res = await rf.auto('How do refunds work for annual plans?', { topK: 2 });

    expect(res.citations).toEqual([1]);
    expect(res.sources[0]).toMatchObject({ ref: 1, id: 'billing.md#3', cited: true });
  });
});
