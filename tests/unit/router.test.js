// Unit tests for the auto-router (no network)

const { createRagforge, classifyQuery } = require('../../index');
const { createFakeProvider } = require('./helpers');

describe('classifyQuery', () => {
  test.each([
    ['PostgreSQL vs MySQL for analytics', 'comparison'],
    ['Which is better, React or Vue?', 'comparison'],
    ['What is HyDE and how does it compare to step-back?', 'comparison'],
    ['What is a vector? What is an embedding?', 'comparison'],
    ['What does error E404 mean?', 'exact'],
    ['How do I call setVectorClient?', 'exact'],
    ['Where is "max_retries" configured?', 'exact'],
    ['What changed in config.yaml?', 'exact'],
    ['refund policy', 'short'],
    ['What is overfitting?', 'short'],
    ['Why does increasing the learning rate cause the loss to diverge?', 'conceptual'],
    ['How does gradient descent find the minimum of a loss function?', 'conceptual'],
    ['How do neural networks learn useful features from raw data?', 'conceptual'],
    ['What are the benefits of regular exercise for older adults?', 'simple'],
    ['How do I install the package from npm into a project?', 'simple'],
  ])('%s -> %s', (query, category) => {
    expect(classifyQuery(query).category).toBe(category);
  });

  test('always returns a reason', () => {
    expect(classifyQuery('').reason).toMatch(/^The query /);
  });
});

describe('route', () => {
  test('maps categories to techniques without any LLM call', async () => {
    const llm = createFakeProvider();
    const rf = createRagforge({ llm });

    expect((await rf.route('PostgreSQL vs MySQL')).technique).toBe('fanout');
    expect((await rf.route('error E404')).technique).toBe('baseline');
    expect((await rf.route('refund policy')).technique).toBe('hyde');
    expect((await rf.route('Why does increasing the learning rate cause the loss to diverge?')).technique).toBe('stepback');
    expect(llm.calls.chat).toHaveLength(0);
  });

  test('custom rules override the defaults', async () => {
    const rf = createRagforge({ llm: createFakeProvider() });
    const r = await rf.route('refund policy', { rules: { short: 'hyde+stepback' }, techniques: ['baseline', 'hyde+stepback'] });

    expect(r).toMatchObject({ technique: 'hyde+stepback', category: 'short', decidedBy: 'rules' });
  });

  test('falls back to baseline when the mapped technique is not allowed', async () => {
    const rf = createRagforge({ llm: createFakeProvider() });
    const r = await rf.route('refund policy', { techniques: ['baseline', 'fanout'] });

    expect(r.technique).toBe('baseline');
    expect(r.reason).toMatch(/hyde is not in the allowed techniques/);
  });

  test('rejects unknown router, techniques and rules', async () => {
    const rf = createRagforge({ llm: createFakeProvider() });

    await expect(rf.route('q', { router: 'magic' })).rejects.toThrow(/router must be/);
    await expect(rf.route('q', { techniques: ['hide'] })).rejects.toThrow(/Unknown eval technique/);
    await expect(rf.route('refund policy', { rules: { short: 'nope' } })).rejects.toThrow(/Unknown eval technique/);
  });

  test('llm classifier uses one cheap deterministic call', async () => {
    const llm = createFakeProvider({ reply: 'Comparison' });
    let stats;
    const r = await createRagforge({ llm }).route('tell me about both', { router: 'llm', onStats: (s) => (stats = s) });

    expect(r).toMatchObject({ technique: 'fanout', category: 'comparison', classifier: 'llm' });
    expect(llm.calls.chat[0]).toMatchObject({ temperature: 0, maxTokens: 10 });
    expect(stats.llmCalls).toBe(1);
  });

  test('llm classifier falls back to rules on an unusable answer', async () => {
    const llm = createFakeProvider({ reply: 'I am not sure' });
    const r = await createRagforge({ llm }).route('refund policy', { router: 'llm' });

    expect(r).toMatchObject({ category: 'short', classifier: 'rules', technique: 'hyde' });
    expect(r.reason).toMatch(/was not a category/);
  });
});

// Minimal evaluate() result: 3 short questions where hyde wins, 3 simple where nothing beats baseline
function fakeEvalResult() {
  const q = (question, ranks) => ({
    question,
    expectedId: 'x',
    runs: Object.fromEntries(Object.entries(ranks).map(([t, rank]) => [t, { rank, queries: [], retrieved: [] }])),
  });
  return {
    techniques: ['baseline', 'hyde', 'fanout'],
    results: [
      { technique: 'baseline', avgLlmCalls: 0 },
      { technique: 'hyde', avgLlmCalls: 1 },
      { technique: 'fanout', avgLlmCalls: 1 },
    ],
    recommendation: { technique: 'hyde', reason: '...' },
    questions: [
      q('refund policy', { baseline: 0, hyde: 1, fanout: 0 }),
      q('shipping times', { baseline: 0, hyde: 2, fanout: 0 }),
      q('warranty', { baseline: 1, hyde: 1, fanout: 0 }),
      q('What are the benefits of regular exercise for older adults?', { baseline: 1, hyde: 1, fanout: 1 }),
      q('What are the main features of the premium subscription plan?', { baseline: 1, hyde: 1, fanout: 0 }),
      q('What documents do I need to open a business bank account?', { baseline: 2, hyde: 1, fanout: 1 }),
    ],
  };
}

describe('route from eval results', () => {
  test('uses the technique that won for that category', async () => {
    const rf = createRagforge({ llm: createFakeProvider() });
    const r = await rf.route('return window', { from: fakeEvalResult() });

    expect(r).toMatchObject({ technique: 'hyde', category: 'short', decidedBy: 'eval' });
    expect(r.reason).toMatch(/On 3 short questions in your eval, hyde found the right chunk 100% of the time vs 33% for plain search/);
  });

  test('ties go to the cheaper technique', async () => {
    const rf = createRagforge({ llm: createFakeProvider() });
    const r = await rf.route('What are the opening hours of the downtown store?', { from: fakeEvalResult() });

    expect(r).toMatchObject({ technique: 'baseline', category: 'simple' });
  });

  test('categories without enough samples use the overall recommendation', async () => {
    const rf = createRagforge({ llm: createFakeProvider() });
    const r = await rf.route('PostgreSQL vs MySQL', { from: fakeEvalResult() });

    expect(r).toMatchObject({ technique: 'hyde', category: 'comparison', decidedBy: 'eval' });
    expect(r.reason).toMatch(/too few comparison questions/);
  });

  test('minImprovement can push a winner back to baseline', async () => {
    const rf = createRagforge({ llm: createFakeProvider() });
    const r = await rf.route('return window', { from: fakeEvalResult(), minImprovement: 0.9 });

    expect(r.technique).toBe('baseline');
  });

  test('works with a JSON round-tripped result', async () => {
    const rf = createRagforge({ llm: createFakeProvider() });
    const saved = JSON.parse(JSON.stringify(fakeEvalResult()));

    expect((await rf.route('return window', { from: saved })).technique).toBe('hyde');
  });

  test('rejects something that is not an eval result', async () => {
    const rf = createRagforge({ llm: createFakeProvider() });
    await expect(rf.route('q', { from: { foo: 1 } })).rejects.toThrow(/must be a result returned by evaluate/);
  });
});

describe('auto', () => {
  const promptsOf = (llm) => llm.calls.chat.map((c) => c.prompt);

  test('baseline route runs only the final synthesis call', async () => {
    const llm = createFakeProvider({ reply: 'answer' });
    const res = await createRagforge({ llm }).auto('What does error E404 mean?');

    expect(res.route).toMatchObject({ technique: 'baseline', category: 'exact' });
    expect(res.answer).toBe('answer');
    expect(llm.calls.chat).toHaveLength(1);
    expect(res.stats.llmCalls).toBe(1);
  });

  test('runs the routed technique through the pipeline', async () => {
    const llm = createFakeProvider();
    const res = await createRagforge({ llm }).auto('PostgreSQL vs MySQL for analytics');

    expect(res.route.technique).toBe('fanout');
    expect(promptsOf(llm).some((p) => p.startsWith('Generate 3 related sub-questions'))).toBe(true);
    expect(res.translation.fanout).not.toBeNull();
    expect(res.translation.hyde).toBeNull();
  });

  test('combined techniques from eval results run together', async () => {
    const llm = createFakeProvider();
    const from = { ...fakeEvalResult(), techniques: ['baseline', 'hyde+stepback'], recommendation: { technique: 'hyde+stepback' } };
    const res = await createRagforge({ llm }).auto('PostgreSQL vs MySQL', { from });

    expect(res.route.technique).toBe('hyde+stepback');
    expect(res.translation.hyde).not.toBeNull();
    expect(res.translation.stepback).not.toBeNull();
  });

  test('pipeline options still apply and the llm classifier call is counted', async () => {
    const llm = createFakeProvider({ reply: 'exact' });
    const res = await createRagforge({ llm }).auto('anything', {
      router: 'llm',
      routerOptions: { model: 'router-model' },
      finalModelOptions: { model: 'final-model' },
    });

    expect(llm.calls.chat.map((c) => c.model)).toEqual(['router-model', 'final-model']);
    expect(res.stats.llmCalls).toBe(2);
  });
});
