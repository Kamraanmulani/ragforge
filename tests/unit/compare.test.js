// Unit tests for comparing eval results and the CLI regression check (no network)

const fs = require('fs');
const os = require('os');
const path = require('path');
const { main } = require('../../src/cli');
const { createRagforge, compareEvals, formatComparison, renderMarkdownReport } = require('../../index');
const { createKeywordProvider } = require('./helpers');

const row = (technique, hitRate, mrr = hitRate, extra = {}) => ({
  technique,
  hitRate,
  mrr,
  avgLatencyMs: 100,
  avgCostUSD: 0.0001,
  totalCostUSD: 0.001,
  avgLlmCalls: 0,
  errors: 0,
  ...extra,
});

function result(rows, extra = {}) {
  return {
    topK: 5,
    questionCount: 10,
    chunkCount: 20,
    techniques: rows.map((r) => r.technique),
    provider: { llm: 'openai', chatModel: 'gpt-4o-mini', embeddings: 'openai', embeddingModel: 'text-embedding-3-small' },
    setup: { costUSD: 0 },
    results: rows,
    ranking: [...rows].sort((a, b) => b.hitRate - a.hitRate).map((r) => r.technique),
    best: rows[0].technique,
    recommendation: { technique: rows[0].technique, reason: 'Because.' },
    ...extra,
  };
}

describe('compareEvals', () => {
  test('reports the change for every technique', () => {
    const diff = compareEvals(result([row('baseline', 0.8, 0.65), row('hybrid', 0.7)]), result([row('baseline', 0.7, 0.6), row('hybrid', 0.9)]));

    expect(diff.rows.map((r) => r.technique)).toEqual(['hybrid', 'baseline']);
    const baseline = diff.rows.find((r) => r.technique === 'baseline');
    expect(baseline.hitRate).toEqual({ before: 0.8, after: 0.7, delta: -0.1 });
    expect(baseline.mrr).toEqual({ before: 0.65, after: 0.6, delta: -0.05 });
    expect(baseline.status).toBe('down');
    expect(diff.rows.find((r) => r.technique === 'hybrid').status).toBe('up');
    // Nothing is gated without failOnDrop
    expect(diff.failOnDrop).toBeNull();
    expect(diff.passed).toBe(true);
    expect(diff.regressions).toEqual([]);
    expect(diff.warnings).toEqual([]);
  });

  test('failOnDrop fails only when the drop is larger than the limit', () => {
    const before = result([row('baseline', 0.8), row('hybrid', 0.9)]);
    const after = result([row('baseline', 0.7), row('hybrid', 0.87)]);

    const strict = compareEvals(before, after, { failOnDrop: 3 });
    expect(strict.passed).toBe(false);
    expect(strict.regressions).toEqual(['baseline']);
    expect(strict.rows.find((r) => r.technique === 'hybrid').status).toBe('down');

    // A drop equal to the limit passes: 10 points lost, 10 allowed
    expect(compareEvals(before, after, { failOnDrop: 10 }).passed).toBe(true);
    // 0 fails on any drop
    expect(compareEvals(before, after, { failOnDrop: 0 }).regressions.sort()).toEqual(['baseline', 'hybrid']);
    expect(compareEvals(before, before, { failOnDrop: 0 }).passed).toBe(true);
  });

  test('techniques in only one run are listed, never failed', () => {
    const diff = compareEvals(result([row('baseline', 0.8), row('hyde', 0.9)]), result([row('baseline', 0.8), row('hybrid', 0.2)]), { failOnDrop: 0 });

    expect(diff.rows.map((r) => [r.technique, r.status])).toEqual([
      ['baseline', 'same'],
      ['hybrid', 'new'],
      ['hyde', 'removed'],
    ]);
    expect(diff.rows[1].hitRate).toEqual({ before: null, after: 0.2, delta: null });
    expect(diff.passed).toBe(true);
  });

  test('warns when the runs are not comparable', () => {
    const questions = (list) => list.map((question) => ({ question }));
    const before = result([row('baseline', 0.8)], { questions: questions(['How do cats purr?', 'What is pizza dough?']) });

    const reordered = result([row('baseline', 0.8)], { questions: questions(['what is pizza dough?', 'How do cats purr?']) });
    expect(compareEvals(before, reordered).warnings).toEqual([]);

    const other = result([row('baseline', 0.8)], {
      topK: 3,
      questions: questions(['How do cats purr?', 'How do rockets fly?']),
      provider: { ...before.provider, embeddingModel: 'bge-small' },
    });
    const { warnings } = compareEvals(before, other);
    expect(warnings).toHaveLength(3);
    expect(warnings[0]).toMatch(/top-k differs \(5 in the baseline, 3 now\)/);
    expect(warnings[1]).toMatch(/different questions/);
    expect(warnings[2]).toMatch(/embedding model changed \(text-embedding-3-small in the baseline, bge-small now\)/);

    expect(compareEvals(result([row('hyde', 0.8)]), result([row('hybrid', 0.8)])).warnings[0]).toMatch(/share no technique/);
  });

  test('rejects files that are not eval results', () => {
    const good = result([row('baseline', 0.8)]);
    expect(() => compareEvals([{ question: 'q' }], good)).toThrow(/the baseline is not an eval result/);
    expect(() => compareEvals(good, { results: [] })).toThrow(/the current result is not an eval result/);
    expect(() => compareEvals(good, good, { failOnDrop: -1 })).toThrow(/failOnDrop/);
  });
});

describe('comparison reports', () => {
  const before = result([row('baseline', 0.8, 0.65), row('hyde', 0.6)]);
  const after = result([row('baseline', 0.7, 0.6, { avgLatencyMs: 1500 }), row('hybrid', 0.9)]);

  test('formatComparison prints a table with a verdict', () => {
    const text = formatComparison(compareEvals(before, after, { failOnDrop: 3 }), { baselineName: 'main.json' });

    expect(text).toMatch(/^Compared with main\.json/);
    expect(text).toMatch(/baseline\s+80% → 70%\s+-10\s+0\.650 → 0\.600\s+-0\.050\s+100ms → 1\.5s\s+\$0\.000100 → \$0\.000100\s+✗ regressed/);
    expect(text).toMatch(/hybrid\s+90%\s+0\.900\s+100ms\s+\$0\.000100\s+new/);
    expect(text).toMatch(/hyde\s+60%.*removed/);
    expect(text).toMatch(/✗ Regression: baseline lost 10 points of hit@5 \(allowed: 3\)\./);

    expect(formatComparison(compareEvals(before, after, { failOnDrop: 10 }))).toMatch(/✓ No regression: no technique lost more than 10 points of hit@5\./);
    // No verdict when nothing is gated
    expect(formatComparison(compareEvals(before, after))).not.toMatch(/egression/);
  });

  test('renderMarkdownReport shows the diff as a Markdown table', () => {
    const md = renderMarkdownReport(after, { comparison: compareEvals(before, after, { failOnDrop: 3 }), baselineName: 'main.json' });

    expect(md).toMatch(/^## ragforge eval\n/);
    expect(md).toMatch(/\*\*✗ Regression: baseline lost 10 points of hit@5 \(allowed: 3\)\.\*\*/);
    expect(md).toContain('| technique | hit@5 | Δ pts | MRR | Δ | latency | cost/query | result |');
    expect(md).toContain('| baseline ★ | 80% → 70% | -10 | 0.650 → 0.600 | -0.050 | 100ms → 1.5s | $0.000100 → $0.000100 | ✗ regressed |');
    expect(md).toContain('| hybrid | 90% |  | 0.900 |  | 100ms | $0.000100 | new |');
    expect(md).toMatch(/10 questions · top 5 · openai gpt-4o-mini \/ text-embedding-3-small/);
    // Every table row has the same number of cells
    const tableRows = md.split('\n').filter((l) => l.startsWith('|'));
    expect(new Set(tableRows.map((l) => l.split('|').length)).size).toBe(1);
  });

  test('renderMarkdownReport without a comparison is the plain scoreboard', () => {
    const md = renderMarkdownReport(after);
    expect(md).toContain('| technique | hit@5 | MRR | latency | cost/query | LLM calls | errors |');
    expect(md).toContain('| hybrid | 90% | 0.900 | 100ms | $0.000100 | 0 |  |');
    expect(md).toMatch(/★ Recommended: \*\*baseline\*\*\. Because\./);
    expect(md).not.toMatch(/Compared with/);
  });

  test('warnings are included in both reports', () => {
    const diff = compareEvals(before, { ...after, topK: 3 });
    expect(formatComparison(diff)).toMatch(/Warning: top-k differs/);
    expect(renderMarkdownReport(after, { comparison: diff })).toMatch(/> ⚠ top-k differs/);
  });
});

describe('ragforge eval --compare', () => {
  let dir;
  beforeEach(() => {
    dir = fs.mkdtempSync(path.join(os.tmpdir(), 'ragforge-compare-'));
    fs.mkdirSync(path.join(dir, 'docs'));
    fs.writeFileSync(path.join(dir, 'docs', 'cats.md'), 'Cats purr when content and groom their fur with rough tongues for hours.');
    fs.writeFileSync(path.join(dir, 'docs', 'pizza.md'), 'Pizza dough is made from flour, water, yeast and salt and baked hot.');
    fs.writeFileSync(path.join(dir, 'docs', 'rockets.md'), 'Rockets burn liquid fuel in engines to produce thrust and reach orbit.');
  });
  afterEach(() => fs.rmSync(dir, { recursive: true, force: true }));

  const capture = () => {
    let text = '';
    return { write: (s) => (text += s), get text() { return text; } };
  };
  const respond = (prompt) => (prompt.includes('Passage:\n') ? `${prompt.split('Passage:\n')[1].split('.')[0]}?` : 'unrelated words');
  const fakeFactory = () => createRagforge({ llm: createKeywordProvider(respond) });
  const run = async (args) => {
    const stdout = capture();
    const stderr = capture();
    const code = await main(args, { stdout, stderr, cwd: dir, createRagforge: fakeFactory });
    return { code, stdout: stdout.text, stderr: stderr.text };
  };
  const readJson = (name) => JSON.parse(fs.readFileSync(path.join(dir, name), 'utf8'));

  test('passes when nothing changed, reusing the baseline file for the questions', async () => {
    const first = await run(['eval', '--docs', 'docs', '--questions', '3', '--techniques', 'baseline,hybrid', '--json', 'main.json']);
    expect(first.code).toBe(0);

    const second = await run([
      'eval', '--docs', 'docs', '--techniques', 'baseline,hybrid',
      '--questions-file', 'main.json', '--compare', 'main.json', '--fail-on-drop', '0', '--json', 'pr.json', '--markdown', 'pr.md',
    ]);
    expect(second.stderr).not.toMatch(/Error/);
    expect(second.code).toBe(0);
    expect(second.stdout).toMatch(/Compared with main\.json/);
    expect(second.stdout).toMatch(/✓ No regression/);
    expect(second.stdout).not.toMatch(/Warning/);
    expect(second.stdout).toMatch(/Markdown report written to pr\.md/);

    // Same questions, now matched on the opening words of their passage, not its chunk id
    const main1 = readJson('main.json');
    const pr = readJson('pr.json');
    expect(pr.questions.map((q) => q.question)).toEqual(main1.questions.map((q) => q.question));
    expect(main1.questions.every((q) => q.expectedId && !q.expectedText)).toBe(true);
    expect(pr.questions.every((q) => !q.expectedId && q.source.startsWith(q.expectedText))).toBe(true);
    expect(pr.questions[0].expectedText.split(' ')).toHaveLength(12);
    expect(pr.results.map((r) => r.hitRate)).toEqual(main1.results.map((r) => r.hitRate));
    expect(fs.readFileSync(path.join(dir, 'pr.md'), 'utf8')).toMatch(/\*\*✓ No regression/);
  });

  test('exits 1 on a regression and still writes the reports', async () => {
    await run(['eval', '--docs', 'docs', '--questions', '3', '--techniques', 'baseline', '--json', 'main.json']);
    expect(readJson('main.json').results[0].hitRate).toBe(1);

    // The docs change: the passage the pizza question was answered from is gone.
    // Its chunk id (docs/pizza.md#1) still exists, so matching on ids would miss this
    fs.writeFileSync(path.join(dir, 'docs', 'pizza.md'), 'Sourdough bread needs a starter and a long, slow rise overnight.');

    const base = ['eval', '--docs', 'docs', '--techniques', 'baseline', '--compare', 'main.json'];
    const gated = await run([...base, '--questions-file', 'main.json', '--fail-on-drop', '3', '--markdown', 'pr.md', '--json', 'pr.json']);
    expect(gated.code).toBe(1);
    expect(gated.stdout).toMatch(/baseline\s+100% → 67%\s+-33\.3/);
    expect(gated.stdout).toMatch(/✗ Regression: baseline lost 33\.3 points of hit@5 \(allowed: 3\)\./);
    expect(readJson('pr.json').results[0].hitRate).toBe(0.667);
    expect(fs.readFileSync(path.join(dir, 'pr.md'), 'utf8')).toMatch(/✗ regressed/);

    // Hand-written golden questions; without --fail-on-drop the comparison is only reported
    fs.writeFileSync(
      path.join(dir, 'golden.json'),
      JSON.stringify(readJson('main.json').questions.map((q) => ({ question: q.question, expectedText: q.source.split(' ').slice(0, 4).join(' ') })))
    );
    const reported = await run([...base, '--questions-file', 'golden.json']);
    expect(reported.code).toBe(0);
    expect(reported.stdout).toMatch(/100% → 67%/);
    expect(reported.stdout).not.toMatch(/egression/);
  });

  test('bad comparison input fails before the eval runs', async () => {
    fs.writeFileSync(path.join(dir, 'questions.json'), JSON.stringify([{ question: 'q', expectedText: 'cats' }]));
    fs.writeFileSync(path.join(dir, 'broken.json'), '{ nope');
    const cases = [
      [['--fail-on-drop', '3'], /--fail-on-drop needs --compare/],
      [['--compare', 'missing.json'], /--compare: cannot read/],
      [['--compare', 'broken.json'], /--compare: .* is not valid JSON/],
      [['--compare', 'questions.json'], /not an eval result/],
      [['--compare', 'questions.json', '--fail-on-drop=-1'], /--fail-on-drop must be a number/],
      [['--compare', 'questions.json', '--fail-on-drop', 'lots'], /--fail-on-drop must be a number/],
      [['--questions-file', 'broken.json'], /--questions-file: .* is not valid JSON/],
    ];
    for (const [extra, message] of cases) {
      const { code, stderr } = await run(['eval', '--docs', 'docs', ...extra]);
      expect(code).toBe(1);
      expect(stderr).toMatch(message);
      expect(stderr).not.toMatch(/Evaluating/);
    }
  });
});
