// Unit tests for the answer-quality eval: judge scoring, evaluate({ answers }), reports and the CI gate (no network)

const fs = require('fs');
const os = require('os');
const path = require('path');
const { main } = require('../../src/cli');
const { createRagforge, formatTable, renderHtmlReport, renderMarkdownReport, compareEvals, formatComparison, JUDGE_VERSION } = require('../../index');
const { judgeAnswer, summarizeAnswers, parseJudgeJson, isQuoted } = require('../../src/eval/judge');
const { createKeywordProvider } = require('./helpers');

const DOCS = [
  { id: 'cats.md', content: 'Cats are small domestic felines. Cats purr when content and groom their fur with rough tongues for many hours every day.' },
  { id: 'rockets.md', content: 'Rockets burn liquid fuel in engines to produce thrust. A rocket launch needs enough thrust to escape gravity and reach orbit.' },
  { id: 'pizza.md', content: 'Pizza dough is made from flour, water, yeast and salt. Neapolitan pizza bakes in a very hot wood oven for ninety seconds.' },
];

const IS = {
  question: (p) => p.includes('Passage:\n'),
  answer: (p) => p.startsWith('You are a helpful assistant that synthesizes'),
  faithfulness: (p) => p.startsWith('You are a strict grader checking whether an answer is supported'),
  answerRelevance: (p) => p.startsWith('You are grading whether an answer addresses'),
  contextRecall: (p) => p.startsWith('You are a strict grader checking whether retrieved passages'),
  citationAccuracy: (p) => p.startsWith('You are a strict grader checking the citations'),
};

// The judge has to quote the passages: this copies the first sentence of passage [1] from a judge prompt
const quote = (prompt) => prompt.split('[1] ')[1].split('.')[0];

// A scripted model: one reply per kind of prompt. HyDE always "hallucinates" about rockets,
// so with topK 1 it retrieves the right passage for the rocket question only.
function scripted(replies = {}) {
  const r = {
    answer: 'The passage states the main fact [1]. The moon is made of cheese.',
    faithfulness: (p) => `\`\`\`json\n${JSON.stringify({ claims: [{ claim: 'the main fact', quote: quote(p), supported: true }, { claim: 'the moon is cheese', quote: null, supported: false }] })}\n\`\`\``,
    answerRelevance: 'Here is my grade: {"score":2}',
    contextRecall: (p) => JSON.stringify({ facts: [{ fact: 'one', quote: null, found: false }, { fact: 'two', quote: quote(p), found: true }] }),
    citationAccuracy: (p) => JSON.stringify({ citations: [{ statement: 'the main fact', passage: 1, quote: quote(p), supported: true }] }),
    ...replies,
  };
  return (prompt) => {
    if (IS.question(prompt)) return `${prompt.split('Passage:\n')[1].split('.')[0]}?`;
    for (const kind of Object.keys(r)) if (IS[kind](prompt)) return typeof r[kind] === 'function' ? r[kind](prompt) : r[kind];
    if (prompt.startsWith('Answer this question in detail')) return 'rocket engines burn fuel for thrust to reach orbit';
    return 'ok';
  };
}

// Minimal call context: records each prompt with its options
function fakeCtx(respond) {
  const calls = [];
  return {
    calls,
    async chat(prompt, options) {
      calls.push({ prompt, options });
      const reply = respond(prompt);
      if (reply instanceof Error) throw reply;
      return reply;
    },
  };
}

describe('judgeAnswer', () => {
  const input = { question: 'How do cats relax?', passages: ['Cats purr when content.', 'Cats groom their fur.'], hit: true };

  test('grades an answer on all four metrics', async () => {
    const ctx = fakeCtx(scripted());
    const { answer, scores, findings, errors } = await judgeAnswer(ctx, input);

    expect(answer).toBe('The passage states the main fact [1]. The moon is made of cheese.');
    expect(scores).toEqual({ faithfulness: 0.5, answerRelevance: 1, contextRecall: 1, citationAccuracy: 1 });
    expect(findings).toEqual({ unsupportedClaims: ['the moon is cheese'] });
    expect(errors).toEqual({});

    // The answer is written with the pipeline's own prompt, from numbered passages
    const [first, ...judges] = ctx.calls;
    expect(first.prompt).toContain('[1] Cats purr when content.\n\n[2] Cats groom their fur.');
    expect(first.prompt).toContain('Cite the passages you use by number');
    // The expected passage was retrieved, so recall needs no judge call
    expect(judges).toHaveLength(3);
    expect(judges.some((c) => IS.contextRecall(c.prompt))).toBe(false);
    judges.forEach((c) => expect(c.options).toMatchObject({ temperature: 0 }));
  });

  test('passes answer and judge options to the right calls', async () => {
    const ctx = fakeCtx(scripted());
    await judgeAnswer(ctx, { ...input, answerOptions: { model: 'small' }, judgeOptions: { model: 'big' } });

    expect(ctx.calls[0].options).toEqual({ model: 'small' });
    ctx.calls.slice(1).forEach((c) => expect(c.options).toMatchObject({ model: 'big', temperature: 0 }));
  });

  test('context recall is judged against the reference when the passage was missed', async () => {
    const ctx = fakeCtx(scripted());
    const judged = await judgeAnswer(ctx, { ...input, hit: false, reference: 'Cats knead blankets when they feel safe.' });

    expect(judged.scores.contextRecall).toBe(0.5);
    expect(judged.findings.missingFacts).toEqual(['one']);
    const recall = ctx.calls.find((c) => IS.contextRecall(c.prompt));
    expect(recall.prompt).toContain('Cats knead blankets when they feel safe.');

    // No reference to judge against: a miss is a miss
    const without = await judgeAnswer(fakeCtx(scripted()), { ...input, hit: false });
    expect(without.scores.contextRecall).toBe(0);
  });

  test('a verdict only counts with a quote that is really in the passages', async () => {
    // The judge says yes to everything: once with a real quote, once with an invented one, once with none
    const claims = [
      { claim: 'cats purr', quote: 'Cats **purr**   when content', supported: true },
      { claim: 'cats bark', quote: 'Cats bark at strangers', supported: true },
      { claim: 'cats fly', supported: true },
    ];
    const { scores, findings } = await judgeAnswer(fakeCtx(scripted({ faithfulness: JSON.stringify({ claims }) })), input);

    expect(scores.faithfulness).toBeCloseTo(0.333, 3);
    expect(findings.unsupportedClaims).toEqual(['cats bark', 'cats fly']);
  });

  test('context recall does not accept quotes from the reference', async () => {
    const reference = 'Cats knead blankets when they feel safe.';
    const facts = [{ fact: 'cats knead', quote: 'Cats knead blankets', found: true }, { fact: 'cats purr', quote: 'Cats purr when content', found: true }];
    const { scores } = await judgeAnswer(fakeCtx(scripted({ contextRecall: JSON.stringify({ facts }) })), { ...input, hit: false, reference });

    expect(scores.contextRecall).toBe(0.5);
  });

  test('a citation needs a quote from the passage it cites, and that passage has to exist', async () => {
    const citations = [
      { statement: 'a', passage: 1, quote: 'Cats purr when content', supported: true },
      { statement: 'b', passage: 7, quote: 'Cats purr when content', supported: true },
      { statement: 'c', passage: 2, quote: 'Cats purr when content', supported: true },
      { statement: 'd', passage: 2, quote: null, supported: 'no' },
    ];
    const { scores, findings } = await judgeAnswer(fakeCtx(scripted({ answer: 'A [1]. B [7]. C [2]. D [2].', citationAccuracy: JSON.stringify({ citations }) })), input);

    expect(scores.citationAccuracy).toBe(0.25);
    expect(findings.wrongCitations).toEqual(['[7] b', '[2] c', '[2] d']);
  });

  test('isQuoted ignores Markdown, case and spacing, and checks every part around an ellipsis', () => {
    const passages = ['Use `--top-k 3` to return **three** results.', 'Hybrid search adds BM25.'];
    expect(isQuoted('use --top-k 3 to return three results', passages)).toBe(true);
    expect(isQuoted('Use `--top-k 3` ... three results', passages)).toBe(true);
    expect(isQuoted('Use --top-k 3 … five results', passages)).toBe(false);
    expect(isQuoted('Use --top-k 5', passages)).toBe(false);
    expect(isQuoted(null, passages)).toBe(false);
    expect(isQuoted('a', ['a b c'])).toBe(false);
    expect(isQuoted('Hybrid search adds BM25', [])).toBe(false);
  });

  test('an answer with claims and no citations scores 0 for citations', async () => {
    const ctx = fakeCtx(scripted({ answer: 'Cats purr. Cats groom.' }));
    const { scores } = await judgeAnswer(ctx, input);

    expect(scores.citationAccuracy).toBe(0);
    expect(ctx.calls.some((c) => IS.citationAccuracy(c.prompt))).toBe(false);
  });

  test('an answer with no claims is faithful, and has no citation score', async () => {
    const respond = scripted({ answer: 'The passages do not say.', faithfulness: '{"claims":[]}', answerRelevance: '{"score":0}' });
    const { scores } = await judgeAnswer(fakeCtx(respond), input);

    expect(scores).toEqual({ faithfulness: 1, answerRelevance: 0, contextRecall: 1, citationAccuracy: null });
  });

  test('a judge reply that cannot be read leaves that metric unscored', async () => {
    const respond = scripted({ faithfulness: 'I think it is mostly fine.', answerRelevance: '{"score":9}' });
    const { scores, errors } = await judgeAnswer(fakeCtx(respond), input);

    expect(scores).toEqual({ faithfulness: null, answerRelevance: null, contextRecall: 1, citationAccuracy: 1 });
    expect(errors.faithfulness).toMatch(/did not return JSON/);
    expect(errors.answerRelevance).toMatch(/no score of 0, 1 or 2/);
  });

  test('a failed answer is reported, not graded', async () => {
    const ctx = fakeCtx(scripted({ answer: () => new Error('rate limited') }));
    const judged = await judgeAnswer(ctx, input);

    expect(judged.answer).toBeNull();
    expect(judged.errors).toEqual({ answer: 'rate limited' });
    expect(Object.values(judged.scores)).toEqual([null, null, null, null]);
    expect(ctx.calls).toHaveLength(1);
  });

  test('parseJudgeJson reads JSON wrapped in prose or code fences', () => {
    expect(parseJudgeJson('Sure!\n```json\n{"score": 1}\n```')).toEqual({ score: 1 });
    // Text after the object, braces inside strings and nested objects
    expect(parseJudgeJson('{"claims":[{"claim":"use {braces} and \\"quotes\\"","supported":true}]} I hope this helps {smile}')).toEqual({
      claims: [{ claim: 'use {braces} and "quotes"', supported: true }],
    });
    expect(() => parseJudgeJson('{"claims":[{"claim":"cut')).toThrow(/cut off/);
    expect(() => parseJudgeJson('no json here')).toThrow(/did not return JSON/);
  });
});

describe('summarizeAnswers', () => {
  const judged = (faithfulness, extra = {}) => ({ answer: 'a', scores: { faithfulness, answerRelevance: 1, contextRecall: null, citationAccuracy: null }, errors: {}, ...extra });

  test('means, 95% intervals and counts', () => {
    const summary = summarizeAnswers([judged(1), judged(0.5), judged(null, { errors: { faithfulness: 'bad' } }), { answer: null, scores: {}, errors: { answer: 'x' } }]);

    expect(summary.faithfulness).toBe(0.75);
    // sd of [1, 0.5] is 0.354; 1.96 * 0.354 / sqrt(2)
    expect(summary.ci.faithfulness).toBe(0.49);
    expect(summary.answerRelevance).toBe(1);
    expect(summary.ci.answerRelevance).toBe(0);
    expect(summary.contextRecall).toBeNull();
    expect(summary.ci.contextRecall).toBeNull();
    expect(summary.judged).toBe(3);
    expect(summary.errors).toBe(2);
  });

  test('one score has no interval', () => {
    expect(summarizeAnswers([judged(0.8)])).toMatchObject({ faithfulness: 0.8, ci: { faithfulness: null } });
  });
});

describe('evaluate with answers', () => {
  const run = (options = {}, respond = scripted()) => {
    const llm = createKeywordProvider(respond);
    return createRagforge({ llm })
      .evaluate({ documents: DOCS, techniques: ['baseline', 'hyde'], numQuestions: 3, topK: 1, answers: true, ...options })
      .then((result) => ({ result, llm }));
  };

  test('adds answer scores next to the retrieval scores', async () => {
    const { result } = await run();
    const row = (t) => result.results.find((r) => r.technique === t);

    // Retrieval scores and their cost are what they are without answers
    expect(row('baseline')).toMatchObject({ hitRate: 1, mrr: 1, avgLlmCalls: 0 });
    expect(row('hyde').hitRate).toBeCloseTo(0.333, 3);
    expect(row('hyde').avgLlmCalls).toBe(1);

    expect(row('baseline').answers).toMatchObject({ faithfulness: 0.5, answerRelevance: 1, contextRecall: 1, citationAccuracy: 1, judged: 3, errors: 0 });
    // hyde: one hit (1), two misses judged at 0.5 against the source passage
    expect(row('hyde').answers.contextRecall).toBeCloseTo(0.667, 3);
    expect(row('hyde').answers.ci.contextRecall).toBeGreaterThan(0);
    expect(row('baseline').answers.ci.faithfulness).toBe(0);

    expect(result.answers).toMatchObject({ judgeVersion: JUDGE_VERSION, judgeModel: 'gpt-4o-mini', generated: 5 });
    // 5 answers x (answer + 3 judges), plus a recall judge for hyde's two misses
    expect(result.answers.usage.llmCalls).toBe(22);

    const runs = result.questions[0].runs;
    expect(runs.baseline).toMatchObject({ rank: 1, answer: expect.stringContaining('[1]'), scores: { faithfulness: 0.5, contextRecall: 1 } });
    expect(runs.baseline.findings).toEqual({ unsupportedClaims: ['the moon is cheese'] });
    expect(runs.baseline.passages).toBeUndefined();
    expect(runs.baseline.judgeErrors).toBeUndefined();
  });

  test('techniques that retrieved the same passages share one answer', async () => {
    const { result, llm } = await run({ techniques: ['baseline', 'hybrid'] });

    expect(result.answers.generated).toBe(3);
    expect(llm.calls.chat.filter((c) => IS.answer(c.prompt))).toHaveLength(3);
    expect(result.results.map((r) => r.answers.judged)).toEqual([3, 3]);
    expect(result.questions[0].runs.hybrid.answer).toBe(result.questions[0].runs.baseline.answer);
  });

  test('judgeOptions pick the judge model; answers use llmOptions', async () => {
    const { result, llm } = await run({ techniques: ['baseline'], llmOptions: { model: 'writer' }, judgeOptions: { model: 'grader' } });

    expect(result.answers.judgeModel).toBe('grader');
    const models = (kind) => [...new Set(llm.calls.chat.filter((c) => IS[kind](c.prompt)).map((c) => c.model))];
    expect(models('answer')).toEqual(['writer']);
    expect(models('faithfulness')).toEqual(['grader']);
    expect(llm.calls.chat.filter((c) => IS.faithfulness(c.prompt)).every((c) => c.temperature === 0)).toBe(true);
  });

  test('judge failures are counted and kept per question', async () => {
    const { result } = await run({ techniques: ['baseline'] }, scripted({ faithfulness: 'not json' }));

    expect(result.results[0].answers).toMatchObject({ faithfulness: null, answerRelevance: 1, judged: 3, errors: 3 });
    expect(result.questions[0].runs.baseline.judgeErrors.faithfulness).toMatch(/did not return JSON/);
  });

  test('without answers the result is unchanged', async () => {
    const { result, llm } = await run({ answers: false });

    expect(result.answers).toBeUndefined();
    expect(result.results[0].answers).toBeUndefined();
    expect(result.questions[0].runs.baseline.answer).toBeUndefined();
    expect(llm.calls.chat.some((c) => IS.answer(c.prompt))).toBe(false);
  });

  test('needs a chat model', async () => {
    const embedOnly = { ...createKeywordProvider(scripted()), name: 'local', chatModel: null };
    await expect(createRagforge({ llm: embedOnly }).evaluate({ documents: DOCS, questions: [{ question: 'q', expectedText: 'cats' }], answers: true }))
      .rejects.toThrow(/answers need a chat model, and the local provider has none/);
  });

  test('reports show the answer columns', async () => {
    const { result } = await run();

    const table = formatTable(result);
    expect(table).toMatch(/technique\s+hit@1\s+MRR\s+faithful\s+relevance\s+ctx recall\s+citations\s+latency/);
    expect(table).toMatch(/baseline ★\s+100%\s+1\.000\s+50%\s+100%\s+100%\s+100%/);
    expect(table).toMatch(/hyde\s+33%\s+0\.333\s+50%\s+100%\s+67% ±\d+\s+100%/);
    expect(table).toMatch(/Answers: 5 written and graded by gpt-4o-mini \(judge v1\), cost \S+\. ± is the 95% interval across questions\./);

    const html = renderHtmlReport(result);
    expect(html).toContain('<th>faithful</th><th>relevance</th><th>ctx recall</th><th>citations</th>');
    expect(html).toMatch(/Answer quality is graded by an LLM judge/);
    expect(html).toMatch(/title="The passage states the main fact \[1\]\./);

    const md = renderMarkdownReport(result);
    expect(md).toContain('| technique | hit@1 | MRR | faithful | relevance | ctx recall | citations | latency | cost/query | LLM calls | errors |');
    expect(md).toMatch(/Answers: 5 written and graded/);
    const tableRows = md.split('\n').filter((l) => l.startsWith('|'));
    expect(new Set(tableRows.map((l) => l.split('|').length)).size).toBe(1);
  });
});

describe('comparing answer scores', () => {
  const result = (faithfulness, extra = {}) => ({
    topK: 5,
    questionCount: 10,
    results: [{ technique: 'baseline', hitRate: 0.8, mrr: 0.7, avgLatencyMs: 100, avgCostUSD: 0, avgLlmCalls: 0, errors: 0, ...(faithfulness !== null && { answers: { faithfulness } }) }],
    ranking: ['baseline'],
    recommendation: { technique: 'baseline', reason: 'Because.' },
    ...(faithfulness !== null && { answers: { judgeVersion: 1, judgeModel: 'gpt-4o-mini', generated: 10, usage: { costUSD: 0.01 } } }),
    ...extra,
  });

  test('a faithfulness drop fails the gate even when retrieval held', () => {
    const diff = compareEvals(result(0.9), result(0.8), { failOnDrop: 3 });

    expect(diff.answers).toBe(true);
    expect(diff.passed).toBe(false);
    expect(diff.rows[0]).toMatchObject({ status: 'regressed', regressedOn: ['faithfulness'], faithfulness: { before: 0.9, after: 0.8, delta: -0.1 } });

    const text = formatComparison(diff);
    expect(text).toMatch(/technique\s+hit@5\s+Δ pts\s+MRR\s+Δ\s+faithful\s+Δ pts/);
    expect(text).toMatch(/baseline\s+80% → 80%\s+0\s+0\.700 → 0\.700\s+0\.000\s+90% → 80%\s+-10\s/);
    expect(text).toMatch(/✗ Regression: baseline lost 10 points of faithfulness \(allowed: 3\)\./);

    const passing = compareEvals(result(0.9), result(0.88), { failOnDrop: 3 });
    expect(passing.passed).toBe(true);
    expect(formatComparison(passing)).toMatch(/no technique lost more than 3 points of hit@5 or faithfulness\./);
  });

  test('markdown comparison includes faithfulness', () => {
    const md = renderMarkdownReport(result(0.8), { comparison: compareEvals(result(0.9), result(0.8), { failOnDrop: 3 }) });
    expect(md).toContain('| technique | hit@5 | Δ pts | MRR | Δ | faithful | Δ pts | latency | cost/query | result |');
    expect(md).toContain('| 90% → 80% | -10 |');
    const tableRows = md.split('\n').filter((l) => l.startsWith('|'));
    expect(new Set(tableRows.map((l) => l.split('|').length)).size).toBe(1);
  });

  test('warns when only one run has answers, or the judge changed', () => {
    const oneSided = compareEvals(result(null), result(0.5), { failOnDrop: 0 });
    expect(oneSided.answers).toBe(false);
    expect(oneSided.passed).toBe(true);
    expect(oneSided.warnings[0]).toMatch(/Only the current run has answer scores/);
    expect(formatComparison(oneSided)).not.toMatch(/faithful\s/);
    expect(compareEvals(result(0.5), result(null)).warnings[0]).toMatch(/Only the baseline has answer scores/);

    const otherJudge = result(0.9, { answers: { judgeVersion: 2, judgeModel: 'gpt-4o', generated: 10, usage: { costUSD: 0 } } });
    expect(compareEvals(result(0.9), otherJudge).warnings[0]).toMatch(/different judges \(gpt-4o-mini \(judge v1\) in the baseline, gpt-4o \(judge v2\) now\)/);
    expect(compareEvals(result(0.9), result(0.9)).warnings).toEqual([]);
  });
});

describe('ragforge eval --answers', () => {
  let dir;
  beforeEach(() => {
    dir = fs.mkdtempSync(path.join(os.tmpdir(), 'ragforge-answers-'));
    fs.mkdirSync(path.join(dir, 'docs'));
    for (const doc of DOCS) fs.writeFileSync(path.join(dir, 'docs', doc.id), doc.content);
  });
  afterEach(() => fs.rmSync(dir, { recursive: true, force: true }));

  const capture = () => {
    let text = '';
    return { write: (s) => (text += s), get text() { return text; } };
  };
  const cli = async (args, respond = scripted()) => {
    const stdout = capture();
    const stderr = capture();
    const llm = createKeywordProvider(respond);
    const code = await main(args, { stdout, stderr, cwd: dir, createRagforge: () => createRagforge({ llm }) });
    return { code, stdout: stdout.text, stderr: stderr.text, llm };
  };

  test('prints the answer columns and writes them to the JSON', async () => {
    const { code, stdout, stderr, llm } = await cli(['eval', '--docs', 'docs', '--questions', '3', '--techniques', 'baseline', '--answers', '--judge-model', 'grader', '--json', 'r.json']);

    expect(stderr).not.toMatch(/Error/);
    expect(code).toBe(0);
    expect(stderr).toMatch(/Writing and grading answers \(3\)/);
    expect(stdout).toMatch(/faithful\s+relevance\s+ctx recall\s+citations/);
    expect(stdout).toMatch(/graded by grader \(judge v1\)/);
    expect(llm.calls.chat.filter((c) => IS.faithfulness(c.prompt)).every((c) => c.model === 'grader')).toBe(true);

    const json = JSON.parse(fs.readFileSync(path.join(dir, 'r.json'), 'utf8'));
    expect(json.results[0].answers.faithfulness).toBe(0.5);
    expect(json.answers.judgeModel).toBe('grader');
  });

  test('--fail-on-drop catches an answer-quality regression', async () => {
    const args = ['eval', '--docs', 'docs', '--techniques', 'baseline', '--answers'];
    expect((await cli([...args, '--questions', '3', '--json', 'main.json'])).code).toBe(0);

    // Same retrieval, but the model now makes things up
    const worse = scripted({ faithfulness: '{"claims":[{"claim":"a","quote":null,"supported":false},{"claim":"b","quote":null,"supported":false}]}' });
    const { code, stdout } = await cli([...args, '--questions-file', 'main.json', '--compare', 'main.json', '--fail-on-drop', '5'], worse);

    expect(code).toBe(1);
    expect(stdout).toMatch(/100% → 100%\s+0\s+1\.000 → 1\.000\s+0\.000\s+50% → 0%\s+-50/);
    expect(stdout).toMatch(/✗ Regression: baseline lost 50 points of faithfulness \(allowed: 5\)\./);
  });

  test('--judge-model needs --answers', async () => {
    const { code, stderr } = await cli(['eval', '--docs', 'docs', '--judge-model', 'grader']);
    expect(code).toBe(1);
    expect(stderr).toMatch(/--judge-model needs --answers/);
  });
});
