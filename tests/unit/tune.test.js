// Unit tests for ragforge tune (roadmap 7.1), no network

const fs = require('fs');
const os = require('os');
const path = require('path');
const { PassThrough } = require('stream');
const { createRagforge, loadConfig, formatTuneTable, renderTuneHtml } = require('../../index');
const { pickWinner, paretoFront, memoize, defaultRefineTechniques, suggestedEmbeddingModels } = require('../../src/tune/tune');
const { createTracker } = require('../../src/core/stats');
const { DEFAULT_PRICING } = require('../../src/core/pricing');
const { main } = require('../../src/cli');
const { startMcpServer } = require('../../src/mcp/server');
const { createKeywordProvider, createFakeProvider } = require('./helpers');

// Two products with the same sections. Only the top heading names the product, so
// paragraph chunks of the later sections can't tell the products apart, while
// markdown-heading chunks start with "Zephyr > Support".
const section = (name, text) => `## ${name}\n\n${text}`;
const filler = ' The team reviews this policy every quarter and publishes changes in the release notes, with examples and a short summary for administrators.';
const doc = (product, n) =>
  [
    `# ${product}`,
    section('Refunds', `Refunds take ${n.r} business days to reach the original card after approval by the billing team.${filler}`),
    section('Invoices', `Invoices are emailed on day ${n.i} of each month to the owner of the account with usage per project.${filler}`),
    section('Support', `Support answers within ${n.s} hours on weekdays through the help center and by email for paid plans.${filler}`),
    section('Security', `Security reviews happen every ${n.x} months and cover access logs, encryption keys and staff permissions.${filler}`),
  ].join('\n\n');
const PRODUCTS = [
  ['Acme', { r: 'five', i: 'one', s: 'four', x: 'six' }],
  ['Zephyr', { r: 'nine', i: 'two', s: 'nine', x: 'three' }],
  ['Orbit', { r: 'ten', i: 'three', s: 'two', x: 'eight' }],
];
const DOCS = PRODUCTS.map(([product, n]) => ({ id: `${product.toLowerCase()}.md`, content: doc(product, n) }));
// 12 questions; the default setup misses 2 of them, enough for a clear paired win
const QUESTIONS = PRODUCTS.flatMap(([product, n]) => [
  { question: `${product} refunds`, expectedText: `Refunds take ${n.r}` },
  { question: `${product} invoices`, expectedText: `Invoices are emailed on day ${n.i}` },
  { question: `${product} support`, expectedText: `Support answers within ${n.s}` },
  { question: `${product} security`, expectedText: `Security reviews happen every ${n.x}` },
]);
// HyDE drafts something unrelated, so it hurts here
const respond = () => 'unrelated words entirely';
const BASE = { documents: DOCS, questions: QUESTIONS, chunkStrategies: ['paragraph', 'markdown-heading'], chunkSizes: [800], topK: 1, topSetups: 1, techniques: ['hyde'] };

const tmpDirs = [];
function tmp() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'ragforge-tune-'));
  tmpDirs.push(dir);
  return dir;
}
afterAll(() => tmpDirs.forEach((d) => fs.rmSync(d, { recursive: true, force: true })));

const trial = (id, hitRate, { mrr = hitRate, avgCostUSD = 0.000001, avgLlmCalls = 0, technique = 'baseline', isDefault = false } = {}) => ({
  id,
  setupId: id,
  technique,
  hitRate,
  mrr,
  avgCostUSD,
  avgLlmCalls,
  isDefault,
  avgLatencyMs: 1,
});

describe('pickWinner', () => {
  test('a costlier technique has to beat the best free trial by minImprovement', () => {
    const def = trial('default', 0.7, { isDefault: true });
    const free = trial('heading', 0.8);
    const close = trial('hyde', 0.83, { technique: 'hyde', avgLlmCalls: 1, avgCostUSD: 0.0001 });
    expect(pickWinner([def, free, close], def, 0.05).trial).toBe(free);
    const far = trial('hyde', 0.85, { technique: 'hyde', avgLlmCalls: 1, avgCostUSD: 0.0001 });
    // 0.85 - 0.8 is 0.04999... in floating point, and still counts as 5 points
    const pick = pickWinner([def, free, far], def, 0.05);
    expect(pick.trial).toBe(far);
    expect(pick.reason).toMatch(/\+5 points over the best setup without extra calls/);
  });

  test('a tie with the default keeps the default; contextual and rerank count as costly', () => {
    const def = trial('default', 0.8, { isDefault: true });
    const same = trial('sentence', 0.8);
    expect(pickWinner([same, def], def, 0.05).trial).toBe(def);
    const contextual = trial('ctx', 0.82, { technique: 'contextual' });
    const pick = pickWinner([def, contextual], def, 0.05);
    expect(pick.trial).toBe(def);
    expect(pick.reason).toMatch(/contextual on ctx scored 82%, not a clear enough gain to justify its extra cost/);
  });
});

describe('pickWinner on paired questions', () => {
  // 20 questions: rank of the right chunk per question (0: missed)
  const ranked = (id, ranks, opts) => ({ ...trial(id, ranks.filter(Boolean).length / ranks.length, opts), mrr: ranks.reduce((n, r) => n + (r ? 1 / r : 0), 0) / ranks.length, ranks });
  const base = Array(20).fill(1).map((r, i) => (i < 18 ? 1 : 0)); // 90%

  test('one more answer is not a clear win, even at +5 points', () => {
    const free = ranked('free', base, { isDefault: true });
    // Finds 1 more (95%), but ranks 3 others lower: the pattern of a lucky score
    const hyde = ranked('hyde', base.map((r, i) => (i === 18 ? 1 : i < 3 ? 2 : r)), { technique: 'hyde', avgLlmCalls: 1, avgCostUSD: 0.0003 });
    expect(hyde.hitRate).toBe(0.95);
    const pick = pickWinner([free, hyde], free, 0.05);
    expect(pick.trial).toBe(free);
    expect(pick.reason).toMatch(/hyde on hyde scored 95%, not a clear enough gain to justify its extra cost/);
  });

  test('two more answers, with nothing ranked lower, is a clear win', () => {
    const free = ranked('free', base, { isDefault: true });
    const hyde = ranked('hyde', base.map(() => 1).map((r, i) => (i === 19 ? 1 : r)), { technique: 'hyde', avgLlmCalls: 1, avgCostUSD: 0.0003 });
    expect(pickWinner([free, hyde], free, 0.05).trial).toBe(hyde);
  });

  test('a setup that finds one more answer than the default does not replace it', () => {
    const def = ranked('default', base, { isDefault: true });
    const heading = ranked('heading', base.map((r, i) => (i === 18 ? 1 : r)));
    const pick = pickWinner([def, heading], def, 0.05);
    expect(pick.trial).toBe(def);
    expect(pick.reason).toMatch(/baseline on heading scored 95% \(MRR 0\.950\), but ranked the right chunk higher on only 1 more question than it ranked it lower: not a clear win/);
    // With minGainQuestions 1 it would
    expect(pickWinner([def, heading], def, 0.05, 1).trial).toBe(heading);
  });
});

describe('pickWinner among free setups', () => {
  const ranked = (id, ranks, opts) => ({ ...trial(id, ranks.filter(Boolean).length / ranks.length, opts), mrr: ranks.reduce((n, r) => n + (r ? 1 / r : 0), 0) / ranks.length, ranks });
  const at = (hits) => Array.from({ length: 20 }, (_, i) => (i < hits ? 1 : 0));

  test('a cheaper setup that is not clearly worse beats a pricier one with one more answer', () => {
    const def = ranked('paragraph/800/ada', at(10), { isDefault: true, avgCostUSD: 0.000001 });
    const ada = ranked('sentence/1200/ada', at(19), { technique: 'hybrid', avgCostUSD: 0.000001 });
    const small = ranked('sentence/1200/3-small', at(18), { technique: 'hybrid', avgCostUSD: 0.0000002 });
    const pick = pickWinner([def, ada, small], def, 0.05);
    expect(pick.trial).toBe(small);
    expect(pick.reason).toMatch(/hybrid on sentence\/1200\/3-small found the right chunk 90% of the time vs 50% for the default setup, with no extra LLM calls\. hybrid on sentence\/1200\/ada scored 95%, not clearly better than this cheaper setup\./);
    // Index cost decides when cost per query is the same
    const pricey = { ...small, id: 'pricey', setupId: 'pricey', avgCostUSD: 0.000001, indexCostUSD: 0.002 };
    const cheapIndex = { ...ada, indexCostUSD: 0.0004 };
    expect(pickWinner([def, cheapIndex, pricey], def, 0.05).trial).toBe(cheapIndex);
  });

  test('a setup that costs the same, or finds 2 fewer answers, is not "cheaper and as good"', () => {
    // From a real run: same cost per query, index costs $0.00000008 apart, 15 vs 13 answers,
    // and the 13-answer setup ranked higher on 2 more questions
    const def = ranked('default', at(10), { isDefault: true, avgCostUSD: 2.8e-7 });
    const hybrid800 = { ...ranked('sentence/800', [...at(15)].map((r, i) => (i < 2 ? 2 : r)), { technique: 'hybrid', avgCostUSD: 2.8e-7 }), indexCostUSD: 0.00042934 };
    const base1200 = { ...ranked('sentence/1200', at(13), { avgCostUSD: 2.8e-7 }), indexCostUSD: 0.00042926 };
    expect(pickWinner([def, hybrid800, base1200], def, 0.05).trial).toBe(hybrid800);
  });

  test('a clearly better setup is kept even when it costs more', () => {
    const def = ranked('default', at(10), { isDefault: true });
    const best = ranked('best', at(19), { avgCostUSD: 0.000001 });
    const cheap = ranked('cheap', at(15), { avgCostUSD: 0.0000002 });
    expect(pickWinner([def, best, cheap], def, 0.05).trial).toBe(best);
  });
});

describe('pickWinner ties', () => {
  test('an exact tie goes to the simpler technique, whatever the latency', () => {
    const def = trial('default', 0.5, { isDefault: true });
    for (const [baseMs, hybridMs] of [[1, 0], [0, 1]]) {
      const base = { ...trial('heading baseline', 1), avgLatencyMs: baseMs };
      const hybrid = { ...trial('heading hybrid', 1, { technique: 'hybrid' }), avgLatencyMs: hybridMs };
      expect(pickWinner([def, hybrid, base], def, 0.05).trial).toBe(base);
    }
  });
});

describe('paretoFront', () => {
  test('keeps trials nothing beats on both quality and cost, cheapest first', () => {
    const cheap = trial('cheap', 0.6, { avgCostUSD: 0.000001 });
    const mid = trial('mid', 0.8, { avgCostUSD: 0.00001 });
    const worse = trial('worse', 0.7, { avgCostUSD: 0.00002 });
    const top = trial('top', 0.9, { avgCostUSD: 0.0001 });
    expect(paretoFront([top, worse, mid, cheap]).map((t) => t.id)).toEqual(['cheap', 'mid', 'top']);
  });
});

describe('memoize', () => {
  test('each distinct call is made once, repeats keep their usage, failures are retried', async () => {
    const provider = createKeywordProvider(respond);
    const ledger = createTracker(DEFAULT_PRICING);
    const m = memoize(provider, ledger);
    const params = { prompt: 'hi', model: 'gpt-4o-mini' };
    const [a, b] = await Promise.all([m.chat(params), m.chat({ ...params })]);
    expect(a).toBe(b);
    expect(provider.calls.chat).toHaveLength(1);
    expect(ledger.snapshot().llmCalls).toBe(1);
    await m.embed({ text: 'x', model: 'text-embedding-3-small' });
    await m.embed({ text: 'x', model: 'text-embedding-3-small' });
    await m.embed({ text: 'x', model: 'text-embedding-ada-002' });
    expect(provider.calls.embed).toHaveLength(2);
    expect(m.isEmbedded('text-embedding-3-small', 'x')).toBe(true);
    expect(m.embeddingModel).toBe(provider.embeddingModel);

    let fail = true;
    const flaky = memoize({ ...createKeywordProvider(respond), chat: async () => (fail ? Promise.reject(new Error('busy')) : { text: 'ok', usage: {} }) }, ledger);
    await expect(flaky.chat(params)).rejects.toThrow('busy');
    fail = false;
    expect((await flaky.chat(params)).text).toBe('ok');
  });
});

describe('memoize latency', () => {
  test('a reused call waits as long as the real one took, so measured latency stays real', async () => {
    const slow = createFakeProvider({ delayMs: 60 });
    const m = memoize(slow, createTracker(DEFAULT_PRICING));
    const params = { prompt: 'hi', model: 'gpt-4o-mini' };
    await m.chat(params);
    const started = Date.now();
    await m.chat(params);
    expect(Date.now() - started).toBeGreaterThanOrEqual(45);
    expect(slow.calls.chat).toHaveLength(1);

    const fast = memoize(createFakeProvider({ delayMs: 60 }), createTracker(DEFAULT_PRICING), { replayLatency: false });
    await fast.chat(params);
    const t = Date.now();
    await fast.chat(params);
    expect(Date.now() - t).toBeLessThan(30);
  });
});

describe('defaults', () => {
  test('refine techniques add rerank and contextual only when available; OpenAI also tries 3-small', () => {
    expect(defaultRefineTechniques()).toEqual(['hyde', 'stepback', 'fanout', 'hybrid+hyde', 'hybrid+stepback', 'hybrid+fanout']);
    expect(defaultRefineTechniques({ reranker: true, contextual: true }).slice(-4)).toEqual(['rerank', 'hybrid+rerank', 'contextual', 'contextual+hybrid']);
    expect(suggestedEmbeddingModels({ name: 'openai', embeddingModel: 'text-embedding-ada-002' })).toEqual(['text-embedding-ada-002', 'text-embedding-3-small']);
    expect(suggestedEmbeddingModels({ name: 'ollama', embeddingModel: 'nomic-embed-text' })).toEqual(['nomic-embed-text']);
  });
});

describe('rf.tune', () => {
  test('finds the setup that beats the default and explains the change', async () => {
    const llm = createKeywordProvider(respond);
    const plans = [];
    const result = await createRagforge({ llm }).tune({ ...BASE, onPlan: (p) => plans.push(p) });

    expect(plans).toHaveLength(1);
    expect(plans[0]).toMatchObject({ setups: 2, screenTechniques: ['baseline', 'hybrid'], refineTechniques: ['hyde'], topSetups: 1, questions: 12, generateQuestions: false, budgetUSD: 0.5 });
    expect(plans[0].estimate.total).toBeGreaterThan(0);

    const byId = new Map(result.trials.map((t) => [t.id, t]));
    const def = byId.get(result.default);
    expect(def).toMatchObject({ setupId: 'paragraph/800/text-embedding-3-small', technique: 'baseline', isDefault: true, hitRate: 0.833 });
    const best = byId.get(result.best);
    expect(best).toMatchObject({ setupId: 'markdown-heading/800/text-embedding-3-small', technique: 'baseline', hitRate: 1 });
    expect(result.reason).toMatch(/100% of the time vs 83% for the default setup, with no extra LLM calls/);
    // 2 setups x 2 free techniques, then hyde on the best setup
    expect(result.trials.map((t) => `${t.stage} ${t.id}`)).toEqual([
      'screen paragraph/800/text-embedding-3-small baseline',
      'screen paragraph/800/text-embedding-3-small hybrid',
      'screen markdown-heading/800/text-embedding-3-small baseline',
      'screen markdown-heading/800/text-embedding-3-small hybrid',
      'refine markdown-heading/800/text-embedding-3-small hyde',
    ]);
    expect(byId.get('markdown-heading/800/text-embedding-3-small hyde').avgCostUSD).toBeGreaterThan(0);
    expect(result.pareto).toContain(result.best);
    expect(result.warnings[0]).toMatch(/Only 12 questions/);

    expect(result.config).toMatchObject({
      version: 1,
      llm: 'keyword',
      chatModel: 'gpt-4o-mini',
      embeddingModel: 'text-embedding-3-small',
      chunking: { strategy: 'markdown-heading', size: 800, overlap: 0 },
      technique: 'baseline',
      contextual: false,
      hybrid: false,
      topK: 1,
      tuned: { questions: 12, hitRate: 1, default: { hitRate: 0.833, mrr: 0.833 } },
    });
    expect(result.spent.costUSD).toBeGreaterThan(0);
  });

  test('repeated calls are made once: the same chunk embedding and the same HyDE draft', async () => {
    const llm = createKeywordProvider(respond);
    await createRagforge({ llm }).tune({ ...BASE, topSetups: 2, techniques: ['hyde', 'hybrid+hyde'] });
    // One HyDE draft per question, though hyde and hybrid+hyde ran on 2 setups
    expect(llm.calls.chat).toHaveLength(QUESTIONS.length);
    expect(new Set(llm.calls.embed).size).toBe(llm.calls.embed.length);
  });

  test('cost per query is still what production pays, though calls were reused', async () => {
    const llm = createKeywordProvider(respond);
    const result = await createRagforge({ llm }).tune({ ...BASE, topSetups: 2 });
    const hyde = result.trials.filter((t) => t.technique === 'hyde');
    expect(hyde).toHaveLength(2);
    expect(hyde[0].avgCostUSD).toBe(hyde[1].avgCostUSD);
    expect(hyde[0].avgLlmCalls).toBe(1);
  });

  test('generates questions from small passages and matches them by text', async () => {
    const llm = createKeywordProvider((prompt) => (prompt.includes('Passage:\n') ? `Zephyr ${prompt.split('Passage:\n')[1].split(/\s+/).slice(1, 3).join(' ')}` : 'unrelated'));
    const result = await createRagforge({ llm }).tune({ documents: DOCS, numQuestions: 4, chunkStrategies: ['paragraph'], chunkSizes: [200, 800], topSetups: 0, budgetUSD: null });
    expect(result.questionCount).toBe(4);
    result.questions.forEach((x) => {
      expect(x.expectedText).toBe(x.source.split(/\s+/).slice(0, 12).join(' '));
      // Half the smallest chunk size (at least 120 characters): smaller than any setup's chunks
      expect(x.source.length).toBeLessThanOrEqual(120);
      expect(x).not.toHaveProperty('expectedId');
    });
  });

  test('checks everything before spending', async () => {
    const llm = createKeywordProvider(respond);
    const rf = createRagforge({ llm });
    await expect(rf.tune({ ...BASE, questions: [{ question: 'x', expectedId: 'acme.md#1' }] })).rejects.toThrow(/needs `question` and `expectedText`/);
    await expect(rf.tune({ ...BASE, chunkStrategies: ['words'] })).rejects.toThrow(/Unknown chunking strategy/);
    await expect(rf.tune({ ...BASE, chunkSizes: [0] })).rejects.toThrow(/positive whole number/);
    await expect(rf.tune({ ...BASE, techniques: ['rerank'] })).rejects.toThrow(/need a reranker/);
    await expect(rf.tune({ ...BASE, budgetUSD: -1 })).rejects.toThrow(/budgetUSD must be/);
    await expect(rf.tune({ ...BASE, documents: [] })).rejects.toThrow(/needs `documents`/);
    const unpriced = createRagforge({ llm: { ...createKeywordProvider(respond), chatModel: 'mystery' } });
    await expect(unpriced.tune(BASE)).rejects.toThrow(/no price known for mystery/);
    expect(llm.calls.chat).toHaveLength(0);
    expect(llm.calls.embed).toHaveLength(0);
  });

  test('a budget too small for screening stops before any call', async () => {
    const llm = createKeywordProvider(respond);
    await expect(createRagforge({ llm }).tune({ ...BASE, budgetUSD: 0 })).rejects.toThrow(/screening 2 setups would cost about \$0\.\d{4}, over the budget of \$0/);
    expect(llm.calls.embed).toHaveLength(0);
  });

  test('a budget that covers screening but not the LLM techniques skips them and says so', async () => {
    const llm = createKeywordProvider(respond);
    const rf = createRagforge({ llm });
    const { estimate } = await new Promise((resolve, reject) =>
      rf.tune({ ...BASE, budgetUSD: null, topSetups: 0, onPlan: resolve }).catch(reject)
    );
    const result = await rf.tune({ ...BASE, budgetUSD: estimate.screening * 1.5 });
    expect(result.trials.every((t) => t.stage === 'screen')).toBe(true);
    expect(result.warnings.join(' ')).toMatch(/Skipped hyde on markdown-heading\/800\/text-embedding-3-small to stay within the budget/);
    expect(result.spent.costUSD).toBeLessThanOrEqual(estimate.screening * 1.5);
  });

  test('no budget allows models without a price', async () => {
    const llm = { ...createKeywordProvider(respond), chatModel: 'mystery' };
    const result = await createRagforge({ llm }).tune({ ...BASE, budgetUSD: null });
    expect(result.spent.costUSD).toBeNull();
    expect(result.plan.estimate.total).toBeNull();
  });
});

describe('createRagforge({ config })', () => {
  const tuned = (overrides = {}) => ({
    version: 1,
    llm: 'openai',
    chatModel: 'gpt-4.1-mini',
    embeddings: 'openai',
    embeddingModel: 'text-embedding-3-small',
    chunking: { strategy: 'markdown-heading', size: 800, overlap: 0 },
    contextual: false,
    technique: 'hybrid',
    hybrid: true,
    rerank: false,
    reranker: null,
    topK: 1,
    tuned: { questions: 8, hitRate: 1, default: { hitRate: 0.875 } },
    ...overrides,
  });

  test('builds the configured providers and models', () => {
    const rf = createRagforge({ config: tuned() });
    expect(rf.llm).toMatchObject({ name: 'openai', chatModel: 'gpt-4.1-mini' });
    expect(rf.embedder).toMatchObject({ name: 'openai', embeddingModel: 'text-embedding-3-small' });
    expect(rf.config.technique).toBe('hybrid');
    expect(Object.isFrozen(rf.config)).toBe(true);
  });

  test('index() chunks the tuned way and auto() uses the tuned technique and topK', async () => {
    const llm = createKeywordProvider(() => 'An answer [1].');
    const rf = createRagforge({ llm, embeddings: llm, config: tuned() });
    const { count } = await rf.index(DOCS);
    expect(count).toBe(12);
    const result = await rf.auto('Zephyr support');
    expect(result.route).toMatchObject({ technique: 'hybrid', decidedBy: 'config', classifier: 'config' });
    expect(result.route.reason).toMatch(/Tuned with ragforge tune: hybrid on markdown-heading chunks of 800 characters\. It found the right chunk 100% of the time on 8 questions vs 88% for the default setup/);
    expect(result.sources).toHaveLength(1);
    expect(result.sources[0].content).toMatch(/^Zephyr > Support\nSupport answers within nine/);
    // No query rewriting for plain hybrid: the answer is the only LLM call
    expect(result.stats.llmCalls).toBe(1);
    expect((await rf.route('Zephyr support')).decidedBy).toBe('config');
    // Asking to route among techniques still routes
    expect((await rf.route('Zephyr support', { techniques: ['baseline', 'hyde'] })).decidedBy).toBe('rules');
  });

  test('inline options win, a path works, and bad configs are rejected clearly', () => {
    const dir = tmp();
    const file = path.join(dir, 'ragforge.config.json');
    fs.writeFileSync(file, JSON.stringify(tuned()));
    const llm = createKeywordProvider(respond);
    const rf = createRagforge({ llm, config: file, hybrid: false });
    expect(rf.llm).toBe(llm);
    expect(rf.config.chunking.size).toBe(800);

    expect(() => loadConfig(path.join(dir, 'missing.json'))).toThrow(/cannot read .*missing\.json\. Create it with: npx ragforge tune/);
    fs.writeFileSync(path.join(dir, 'bad.json'), '{ nope');
    expect(() => loadConfig(path.join(dir, 'bad.json'))).toThrow(/is not valid JSON/);
    expect(() => loadConfig(tuned({ version: 9 }))).toThrow(/version 9 is not supported/);
    expect(() => loadConfig(tuned({ technique: 'magic' }))).toThrow(/Unknown eval technique "magic"/);
    expect(() => loadConfig(tuned({ chunking: { strategy: 'words' } }))).toThrow(/Unknown chunking strategy/);
    expect(() => createRagforge({ config: tuned({ llm: 'keyword' }) })).toThrow(/The config's llm is "keyword": pass llm to createRagforge/);
  });
});

describe('reports', () => {
  test('the table and the HTML page show the winner, the default and the chart', async () => {
    const result = await createRagforge({ llm: createKeywordProvider(respond) }).tune(BASE);
    const table = formatTuneTable(result);
    expect(table).toMatch(/ragforge tune · 12 questions · 2 setups · 5 trials · top 1/);
    expect(table).toMatch(/★ Best: markdown-heading\/800\/text-embedding-3-small · baseline/);
    expect(table).toMatch(/Changes from the default: chunking paragraph → markdown-heading\. hit@1 83% → 100% \(\+17 points\)/);
    expect(table).toMatch(/Spent \$0\.\d+ of a \$0\.5 budget/);
    const html = renderTuneHtml(result);
    expect(html).toMatch(/<svg viewBox="0 0 640 320"/);
    expect(html).toMatch(/class="best"/);
    expect(html).toMatch(/<span class="badge">default<\/span>/);
    expect((html.match(/<tr/g) ?? []).length).toBe(6);
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
    fs.writeFileSync(path.join(dir, 'q.json'), JSON.stringify(QUESTIONS));
    const factory = (opts) => {
      const llm = createKeywordProvider(respond);
      return createRagforge({ ...opts, llm, embeddings: llm });
    };
    return { dir, factory };
  }
  const TUNE = ['tune', '--docs', 'docs', '--questions-file', 'q.json', '--chunk-strategies', 'paragraph,markdown-heading', '--chunk-sizes', '800', '--top-k', '1', '--top-setups', '1', '--techniques', 'hyde'];

  test('tune prints the plan, the best setup, and writes the config, JSON and HTML', async () => {
    const { dir, factory } = setup();
    const a = io();
    expect(await main([...TUNE, '--json', 'tune.json', '--html', 'tune.html'], { ...a, cwd: dir, createRagforge: factory })).toBe(0);
    expect(a.err).toMatch(/Plan: 2 setups \(paragraph, markdown-heading × 800 chars × text-embedding-3-small\) with baseline and hybrid, then the best 1 with hyde, on 12 questions\./);
    expect(a.err).toMatch(/Estimated cost: \$0\.\d{4} .*budget \$0\.5\./);
    expect(a.err.indexOf('Plan:')).toBeLessThan(a.err.indexOf('Screening 1/2'));
    expect(a.out).toMatch(/★ Best: markdown-heading\/800\/text-embedding-3-small · baseline/);
    expect(a.out).toMatch(/Config written to ragforge\.config\.json/);
    const config = loadConfig(path.join(dir, 'ragforge.config.json'));
    expect(config.chunking).toEqual({ strategy: 'markdown-heading', size: 800, overlap: 0 });
    expect(JSON.parse(fs.readFileSync(path.join(dir, 'tune.json'), 'utf8')).trials).toHaveLength(5);
    expect(fs.readFileSync(path.join(dir, 'tune.html'), 'utf8')).toMatch(/<svg/);
  });

  test('bad flags fail before any work', async () => {
    const { dir, factory } = setup();
    const cases = [
      [['--budget', 'lots'], /--budget must be an amount in US dollars/],
      [['--chunk-sizes', '800,big'], /--chunk-sizes must be positive whole numbers, got "big"/],
      [['--chunk-strategies', 'words'], /--chunk-strategies: "words" is not one of/],
      [['--chunk-size', '500'], /use --chunk-strategies and --chunk-sizes/],
      [['--budget', '0'], /over the budget of \$0/],
    ];
    for (const [flags, message] of cases) {
      const a = io();
      expect(await main([...TUNE, ...flags], { ...a, cwd: dir, createRagforge: factory })).toBe(1);
      expect(a.err).toMatch(message);
    }
    expect(fs.existsSync(path.join(dir, 'ragforge.config.json'))).toBe(false);
  });

  test('chat --config uses the tuned chunking and technique', async () => {
    const { dir, factory } = setup();
    expect(await main(TUNE, { ...io(), cwd: dir, createRagforge: factory })).toBe(0);
    // A keyword provider isn't built in, so the config names it for our factory to replace
    const stdin = new PassThrough();
    stdin.end('Zephyr support\nexit\n');
    const seen = [];
    const chatFactory = (opts) => {
      seen.push(opts);
      const llm = createKeywordProvider(() => 'Nine hours [1].');
      return createRagforge({ ...opts, llm, embeddings: llm });
    };
    const a = io();
    expect(await main(['chat', '--docs', 'docs', '--config', 'ragforge.config.json', '--provider', 'openai', '--embeddings', 'openai'], { ...a, stdin, cwd: dir, createRagforge: chatFactory })).toBe(0);
    expect(a.err).toMatch(/Using ragforge\.config\.json: baseline on markdown-heading chunks of 800 characters\./);
    expect(a.err).toMatch(/Indexed 12 passages/);
    expect(seen[0].config.technique).toBe('baseline');
    expect(a.out).toMatch(/Nine hours \[1\]\./);
    // One line per source, even for chunks that start with a heading trail
    expect(a.out).toMatch(/\[1\] docs\/zephyr\.md#\d+ {2}Zephyr > Support Support answers within nine/);
  });
});

describe('MCP', () => {
  test('topK sets the default passages per call and is checked', async () => {
    await expect(startMcpServer({ documents: DOCS, topK: 0 })).rejects.toThrow(/top_k must be a whole number/);
  });
});
