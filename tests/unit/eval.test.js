// Unit tests for evaluate(), chunking, the memory vector store and reports (no network)

const { createRagforge, createMemoryVectorStore, chunkText, formatTable, renderHtmlReport } = require('../../index');
const { createKeywordProvider, keywordVector } = require('./helpers');

const DOCS = [
  { id: 'cats.md', content: 'Cats are small domestic felines. Cats purr when content and groom their fur with rough tongues for many hours every day.' },
  { id: 'rockets.md', content: 'Rockets burn liquid fuel in engines to produce thrust. A rocket launch needs enough thrust to escape gravity and reach orbit.' },
  { id: 'pizza.md', content: 'Pizza dough is made from flour, water, yeast and salt. Neapolitan pizza bakes in a very hot wood oven for ninety seconds.' },
];

// Generated question = the passage's first sentence, so plain search can find it.
// HyDE always "hallucinates" about rockets, so it only helps the rocket question.
function respond(prompt) {
  if (prompt.includes('Passage:\n')) {
    const passage = prompt.split('Passage:\n')[1];
    return `Question: ${passage.split('.')[0]}?`;
  }
  if (prompt.startsWith('Answer this question in detail')) return 'rocket engines burn fuel for thrust to reach orbit';
  if (prompt.includes('Reformulate it into a more general')) return 'general science question';
  if (prompt.startsWith('Generate 3 related sub-questions')) return 'one?\ntwo?\nthree?';
  return 'ok';
}

describe('chunkText', () => {
  test('packs paragraphs up to the size limit', () => {
    const chunks = chunkText('aaa aaa\n\nbbb bbb\n\nccc ccc', { size: 16 });
    expect(chunks).toEqual(['aaa aaa bbb bbb', 'ccc ccc']);
  });

  test('splits long paragraphs on sentences', () => {
    const text = 'First sentence here. Second sentence here. Third sentence here.';
    const chunks = chunkText(text, { size: 25 });
    expect(chunks).toEqual(['First sentence here.', 'Second sentence here.', 'Third sentence here.']);
    chunks.forEach((c) => expect(c.length).toBeLessThanOrEqual(25));
  });

  test('hard-splits text with no sentence breaks', () => {
    const chunks = chunkText('x'.repeat(50), { size: 20 });
    expect(chunks.map((c) => c.length)).toEqual([20, 20, 10]);
  });
});

describe('chunkDocuments', () => {
  const { chunkDocuments } = require('../../src/eval/chunk');

  test('makes repeated document ids unique', () => {
    const chunks = chunkDocuments([
      { id: 'README.md', content: 'first' },
      { id: 'README.md', content: 'second' },
      'third',
    ]);

    expect(chunks.map((c) => c.id)).toEqual(['README.md#1', 'README.md~2#1', 'doc3#1']);
  });
});

describe('createMemoryVectorStore', () => {
  test('returns nearest items by cosine similarity', async () => {
    const store = createMemoryVectorStore();
    store.add(DOCS.map((d) => ({ id: d.id, content: d.content, vector: keywordVector(d.content) })));

    const [top] = await store.query(keywordVector('yeast flour oven'), 1);

    expect(top.id).toBe('pizza.md');
    expect(top.score).toBeGreaterThan(0);
    expect(store.size).toBe(3);
  });
});

describe('evaluate', () => {
  test('scores techniques on generated questions and recommends baseline when it wins', async () => {
    const llm = createKeywordProvider(respond);
    const rf = createRagforge({ llm });

    const result = await rf.evaluate({ documents: DOCS, techniques: ['baseline', 'hyde'], numQuestions: 3, topK: 1 });

    expect(result.questionCount).toBe(3);
    expect(result.chunkCount).toBe(3);
    const row = (t) => result.results.find((r) => r.technique === t);
    expect(row('baseline')).toMatchObject({ hitRate: 1, mrr: 1, errors: 0 });
    expect(row('hyde').hitRate).toBeCloseTo(0.333, 3);
    expect(result.ranking).toEqual(['baseline', 'hyde']);
    expect(result.recommendation.technique).toBe('baseline');
    expect(result.questions[0]).toMatchObject({ expectedId: 'cats.md#1' });
    expect(result.questions[0].question).not.toMatch(/^Question:/);
    expect(result.questions[0].runs.baseline.rank).toBe(1);
  });

  test('generated questions cycle through styles and name their source document', async () => {
    const llm = createKeywordProvider(respond);
    const result = await createRagforge({ llm }).evaluate({ documents: DOCS, techniques: ['baseline'], numQuestions: 3 });

    expect(result.questions.map((q) => q.style)).toEqual(['question', 'keywords', 'conceptual']);
    const prompts = llm.calls.chat.map((c) => c.prompt);
    expect(prompts[0]).toMatch(/from "cats\.md"/);
    expect(prompts.some((p) => p.includes('short search query'))).toBe(true);
    expect(prompts.some((p) => p.includes('why or how question'))).toBe(true);
  });

  test('vague questions are retried on another chunk', async () => {
    let calls = 0;
    const llm = createKeywordProvider((p) => {
      if (!p.includes('Passage:\n')) return 'ok';
      calls++;
      // First answer points at "the text" instead of naming a subject
      return calls === 1 ? 'What is the purpose of the tool mentioned in the text?' : respond(p);
    });
    const result = await createRagforge({ llm }).evaluate({ documents: DOCS, techniques: ['baseline'], numQuestions: 1, questionStyles: ['question'] });

    expect(result.questions).toHaveLength(1);
    expect(result.questions[0].question).not.toMatch(/mentioned/);
    expect(result.questions[0].expectedId).not.toBe('cats.md#1');
    expect(calls).toBe(2);
  });

  test('fails clearly when no usable question can be generated', async () => {
    const llm = createKeywordProvider((p) => (p.includes('Passage:\n') ? 'What does the passage describe?' : 'ok'));

    await expect(createRagforge({ llm }).evaluate({ documents: DOCS, techniques: ['baseline'], numQuestions: 1 }))
      .rejects.toThrow(/could not generate usable questions/);
  });

  test('setup cost covers indexing and question generation, not technique runs', async () => {
    const llm = createKeywordProvider(respond);
    const result = await createRagforge({ llm }).evaluate({ documents: DOCS, techniques: ['baseline'], numQuestions: 2 });

    expect(result.setup.embeddingCalls).toBe(3);
    expect(result.setup.llmCalls).toBe(2);
    expect(result.results[0].avgLlmCalls).toBe(0); // baseline makes no LLM calls
  });

  test('recommends a technique that clearly beats baseline', async () => {
    const llm = createKeywordProvider(respond);
    const result = await createRagforge({ llm }).evaluate({
      documents: DOCS,
      // Question with no indexable words: baseline can't find it, HyDE can
      questions: [{ question: 'Up?', expectedText: 'escape gravity' }],
      techniques: ['baseline', 'hyde'],
      topK: 1,
    });

    expect(result.recommendation.technique).toBe('hyde');
    expect(result.recommendation.reason).toMatch(/\+100 points/);
  });

  test('small gains over baseline are not recommended', async () => {
    const llm = createKeywordProvider(respond);
    const result = await createRagforge({ llm }).evaluate({
      documents: DOCS,
      questions: [{ question: 'Up?', expectedText: 'escape gravity' }],
      techniques: ['baseline', 'hyde'],
      topK: 1,
      minImprovement: 1.5,
    });

    expect(result.best).toBe('hyde');
    expect(result.recommendation.technique).toBe('baseline');
  });

  test('combined techniques fuse their queries', async () => {
    const llm = createKeywordProvider(respond);
    const result = await createRagforge({ llm }).evaluate({
      documents: DOCS,
      questions: [{ question: 'Up?', expectedText: 'escape gravity' }],
      techniques: ['baseline+hyde'],
      topK: 2,
    });

    const run = result.questions[0].runs['baseline+hyde'];
    expect(run.queries).toHaveLength(2);
    expect(run.rank).toBeGreaterThan(0);
  });

  test('works against the instance vector store with expectedId', async () => {
    const store = createMemoryVectorStore();
    store.add(DOCS.map((d) => ({ id: d.id, content: d.content, vector: keywordVector(d.content) })));
    const llm = createKeywordProvider(respond);
    const rf = createRagforge({ llm, vectorStore: store });

    const result = await rf.evaluate({
      questions: [{ question: 'what makes cats purr', expectedId: 'cats.md' }],
      techniques: ['baseline'],
      topK: 1,
    });

    expect(result.results[0].hitRate).toBe(1);
    expect(result.chunkCount).toBeNull();
  });

  test('a failing technique counts as an error and a miss', async () => {
    const llm = createKeywordProvider((p) => {
      if (p.startsWith('Answer this question')) throw new Error('rate limited');
      return respond(p);
    });
    const result = await createRagforge({ llm }).evaluate({ documents: DOCS, techniques: ['baseline', 'hyde'], numQuestions: 2 });

    const hyde = result.results.find((r) => r.technique === 'hyde');
    expect(hyde).toMatchObject({ errors: 2, hitRate: 0 });
    expect(result.questions[0].runs.hyde.error).toBe('rate limited');
  });

  test('validates input before spending any calls', async () => {
    const llm = createKeywordProvider(respond);
    const rf = createRagforge({ llm });

    await expect(rf.evaluate({ documents: DOCS, techniques: ['hide'] })).rejects.toThrow(/Unknown eval technique/);
    await expect(rf.evaluate({})).rejects.toThrow(/needs `documents`/);
    await expect(rf.evaluate({ documents: DOCS, questions: [{ question: 'q' }] })).rejects.toThrow(/needs `question`/);
    await expect(rf.evaluate({ documents: DOCS, questionStyles: ['riddle'] })).rejects.toThrow(/questionStyles/);
    expect(llm.calls.embed).toHaveLength(0);
    expect(llm.calls.chat).toHaveLength(0);
  });

  test('respects the concurrency limit', async () => {
    let inFlight = 0;
    let max = 0;
    const base = createKeywordProvider(respond);
    const llm = {
      ...base,
      async chat(p) {
        inFlight++;
        max = Math.max(max, inFlight);
        await new Promise((r) => setTimeout(r, 5));
        inFlight--;
        return base.chat(p);
      },
    };
    await createRagforge({ llm }).evaluate({ documents: DOCS, techniques: ['hyde'], numQuestions: 3, concurrency: 2 });

    expect(max).toBeLessThanOrEqual(2);
  });
});

describe('reports', () => {
  async function sampleResult() {
    const llm = createKeywordProvider(respond);
    return createRagforge({ llm }).evaluate({ documents: DOCS, techniques: ['baseline', 'hyde'], numQuestions: 3, topK: 1 });
  }

  test('formatTable shows ranked rows and the recommendation', async () => {
    const table = formatTable(await sampleResult());

    expect(table).toMatch(/hit@1/);
    expect(table).toMatch(/baseline ★/);
    expect(table.indexOf('baseline')).toBeLessThan(table.indexOf('hyde'));
    expect(table).toMatch(/Recommended: baseline/);
  });

  test('renderHtmlReport is self-contained and escapes content', async () => {
    const result = await sampleResult();
    result.questions[0].question = '<script>alert(1)</script>';
    const html = renderHtmlReport(result);

    expect(html).toMatch(/^<!doctype html>/);
    expect(html).not.toMatch(/<script>alert/);
    expect(html).toMatch(/&lt;script&gt;/);
    expect(html).not.toMatch(/https?:\/\/(?!www\.w3)/); // no external assets
  });
});
