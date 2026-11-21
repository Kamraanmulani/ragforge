// Unit tests for tracing (onTrace), `ragforge label` and `eval --from-logs` (no network)

const fs = require('fs');
const os = require('os');
const path = require('path');
const { PassThrough } = require('stream');
const { main } = require('../../src/cli');
const { createRagforge, createMemoryVectorStore, createTraceLogger, readTraces } = require('../../index');
const { uniqueQueries, sample } = require('../../src/core/trace');
const { labelQueries, labelledQuestions, openingWords } = require('../../src/eval/label');
const { createKeywordProvider, keywordVector } = require('./helpers');

const DOCS = [
  { id: 'cats.md', content: 'Cats are small domestic felines. Cats purr when content and groom their fur with rough tongues for many hours every day.' },
  { id: 'rockets.md', content: 'Rockets burn liquid fuel in engines to produce thrust. A rocket launch needs enough thrust to escape gravity and reach orbit.' },
  { id: 'pizza.md', content: 'Pizza dough is made from flour, water, yeast and salt. Neapolitan pizza bakes in a very hot wood oven for ninety seconds.' },
];

const respond = (prompt) => (prompt.includes('Passage:\n') ? `${prompt.split('Passage:\n')[1].split('.')[0]}?` : 'Cats purr when content [1].');

function instance(options = {}) {
  const store = createMemoryVectorStore();
  store.add(DOCS.map((d) => ({ id: d.id, content: d.content, vector: keywordVector(d.content) })));
  return createRagforge({ llm: createKeywordProvider(respond), vectorStore: store, ...options });
}

const capture = () => {
  let text = '';
  return { write: (s) => (text += s), get text() { return text; } };
};

// Stdin for the label command: the lines the user would type
function typed(lines) {
  const input = new PassThrough();
  input.end(lines.map((l) => `${l}\n`).join(''));
  return input;
}

let dir;
beforeEach(() => {
  dir = fs.mkdtempSync(path.join(os.tmpdir(), 'ragforge-trace-'));
});
afterEach(() => fs.rmSync(dir, { recursive: true, force: true }));

describe('onTrace', () => {
  test('auto() reports the query, route, sources, answer and stats', async () => {
    const traces = [];
    const rf = instance({ onTrace: (t) => traces.push(t) });

    const result = await rf.auto('why do cats purr', { topK: 2 });

    expect(traces).toHaveLength(1);
    const [trace] = traces;
    expect(trace).toMatchObject({ type: 'auto', query: 'why do cats purr', answer: result.answer, citations: [1] });
    expect(trace.route).toEqual({ technique: result.route.technique, category: result.route.category, decidedBy: result.route.decidedBy, reason: result.route.reason });
    expect(trace.sources).toHaveLength(2);
    expect(trace.sources[0]).toMatchObject({ ref: 1, id: 'cats.md', cited: true, content: DOCS[0].content });
    expect(trace.sources[1].cited).toBe(false);
    expect(trace.stats.llmCalls).toBeGreaterThan(0);
    expect(new Date(trace.timestamp).getTime()).not.toBeNaN();
    // Plain JSON, so it can be logged anywhere
    expect(JSON.parse(JSON.stringify(trace))).toEqual(trace);
  });

  test('ragPipeline() is traced without a route; other calls are not traced', async () => {
    const traces = [];
    const rf = instance({ onTrace: (t) => traces.push(t) });

    await rf.ragPipeline('pizza dough', { techniques: [] });
    await rf.hyde('pizza dough');
    await rf.route('pizza dough');

    expect(traces.map((t) => [t.type, t.route])).toEqual([['ragPipeline', null]]);
  });

  test('a streamed answer is traced once the stream ends', async () => {
    const traces = [];
    const rf = instance({ onTrace: (t) => traces.push(t) });

    const result = await rf.auto('why do cats purr', { stream: true });
    expect(traces).toHaveLength(0);
    for await (const token of result.stream) void token;
    await result.stats;

    expect(traces).toHaveLength(1);
    expect(traces[0]).toMatchObject({ type: 'auto', answer: 'Cats purr when content [1].', citations: [1] });
    expect(traces[0].stats.llmCalls).toBeGreaterThan(0);
  });

  test('a hook that throws does not fail the call', async () => {
    const errors = [];
    const rf = instance({
      onTrace: () => {
        throw new Error('disk full');
      },
      logger: { error: (msg) => errors.push(msg) },
    });

    const result = await rf.auto('why do cats purr');
    expect(result.answer).toBe('Cats purr when content [1].');
    expect(errors.join('\n')).toMatch(/onTrace failed: disk full/);
  });

  test('a file path appends JSONL that readTraces reads back', async () => {
    const file = path.join(dir, 'logs', 'traces.jsonl');
    const rf = instance({ onTrace: file });

    await rf.auto('why do cats purr');
    await rf.auto('how hot is a pizza oven');

    const lines = fs.readFileSync(file, 'utf8').trim().split('\n');
    expect(lines).toHaveLength(2);
    const { traces, skipped } = readTraces(file);
    expect(skipped).toBe(0);
    expect(traces.map((t) => t.query)).toEqual(['why do cats purr', 'how hot is a pizza oven']);
    expect(traces[0].sources[0].content).toBe(DOCS[0].content);
  });

  test('createTraceLogger({ includeText: false }) keeps ids and stats, drops passage text and answers', async () => {
    const file = path.join(dir, 'traces.jsonl');
    const rf = instance({ onTrace: createTraceLogger(file, { includeText: false }) });
    await rf.auto('why do cats purr');

    const [trace] = readTraces(file).traces;
    expect(trace.query).toBe('why do cats purr');
    expect(trace.answer).toBeUndefined();
    expect(trace.sources[0]).toMatchObject({ ref: 1, id: 'cats.md' });
    expect(trace.sources[0].content).toBeUndefined();
    expect(trace.stats.llmCalls).toBeGreaterThan(0);
  });

  test('rejects an onTrace that is neither a function nor a path', () => {
    expect(() => instance({ onTrace: 42 })).toThrow(/onTrace must be a function or a file path/);
  });
});

describe('reading trace logs', () => {
  test('readTraces skips bad lines and accepts "question" as the query', () => {
    const file = path.join(dir, 't.jsonl');
    fs.writeFileSync(file, ['{"query":"  a  "}', 'not json', '', '{"question":"b"}', '{"query":""}', '{"other":1}'].join('\r\n'));

    const { traces, skipped } = readTraces(file);
    expect(traces.map((t) => t.query)).toEqual(['a', 'b']);
    expect(skipped).toBe(3);
  });

  test('uniqueQueries counts repeats, ignoring case and spacing', () => {
    const queries = uniqueQueries([{ query: 'How do refunds work?' }, { query: 'pricing' }, { query: 'how do  refunds work?' }]);
    expect(queries.map((q) => [q.query, q.count])).toEqual([['How do refunds work?', 2], ['pricing', 1]]);
  });

  test('sample spreads evenly and is repeatable', () => {
    const items = Array.from({ length: 10 }, (_, i) => i);
    expect(sample(items, 3)).toEqual([0, 3, 6]);
    expect(sample(items, 3)).toEqual(sample(items, 3));
    expect(sample(items, 20)).toEqual(items);
  });
});

describe('labelQueries', () => {
  const chunks = DOCS.map((d) => ({ id: `${d.id}#1`, content: d.content }));
  const label = (queries, lines) => {
    const output = capture();
    const saved = [];
    return labelQueries({ queries, chunks, input: typed(lines), output, onLabel: (l) => saved.push(l) }).then((result) => ({ ...result, output: output.text, saved }));
  };

  test('a number picks the passage that answers the query', async () => {
    const { labels, output, saved, quit } = await label([{ query: 'how do cats purr', count: 3 }], ['1']);

    expect(labels).toEqual([{ question: 'how do cats purr', expectedText: openingWords(DOCS[0].content), source: DOCS[0].content, chunkId: 'cats.md#1' }]);
    expect(labels[0].expectedText.split(' ')).toHaveLength(12);
    expect(saved).toEqual(labels);
    expect(quit).toBe(false);
    expect(output).toMatch(/\[1\/1\] how do cats purr {2}\(asked 3 times\)/);
    expect(output).toMatch(/1\. cats\.md#1\n {5}Cats are small domestic felines/);
  });

  test('other words search again; n, s and q do what they say', async () => {
    const queries = [{ query: 'why is my oven so slow' }, { query: 'refund policy' }, { query: 'rocket thrust' }, { query: 'cats' }];
    const { labels, skipped, quit, output } = await label(queries, ['9', 'pizza dough yeast', '1', 'n', 's', 'q']);

    expect(output).toMatch(/There is no passage 9\./);
    expect(output).toMatch(/Searching for: pizza dough yeast/);
    expect(labels).toEqual([
      expect.objectContaining({ question: 'why is my oven so slow', chunkId: 'pizza.md#1' }),
      { question: 'refund policy', noAnswer: true },
    ]);
    expect(skipped).toBe(1);
    expect(quit).toBe(true);
    expect(output).toMatch(/No passage matches these words\./);
  });

  test('running out of input stops like q', async () => {
    const { labels, quit } = await label([{ query: 'cats' }, { query: 'pizza' }], ['1']);
    expect(labels).toHaveLength(1);
    expect(quit).toBe(true);
  });

  test('labelledQuestions joins log queries with their labels', () => {
    const queries = [{ query: 'How do cats purr?' }, { query: 'refund policy' }, { query: 'rocket thrust' }];
    const labels = [
      { question: 'how do  cats purr?', expectedText: 'Cats are small', source: 'Cats are small domestic felines.', chunkId: 'cats.md#1' },
      { question: 'refund policy', noAnswer: true },
      { question: 'not in the log', expectedText: 'x' },
    ];

    expect(labelledQuestions(queries, labels)).toEqual({
      questions: [{ question: 'How do cats purr?', expectedText: 'Cats are small', source: 'Cats are small domestic felines.' }],
      noAnswer: 1,
      unlabelled: 1,
    });
  });
});

describe('ragforge label and eval --from-logs', () => {
  const fakeFactory = () => createRagforge({ llm: createKeywordProvider(respond) });
  const run = async (args, lines = []) => {
    const stdout = capture();
    const stderr = capture();
    const code = await main(args, { stdout, stderr, cwd: dir, stdin: typed(lines), createRagforge: fakeFactory });
    return { code, stdout: stdout.text, stderr: stderr.text };
  };
  const labelsFile = () => JSON.parse(fs.readFileSync(path.join(dir, 'ragforge-labels.json'), 'utf8'));

  beforeEach(() => {
    fs.mkdirSync(path.join(dir, 'docs'));
    for (const doc of DOCS) fs.writeFileSync(path.join(dir, 'docs', doc.id), doc.content);
    const queries = ['how do cats purr', 'pizza oven heat', 'How do cats purr', 'refund policy', 'rocket thrust orbit'];
    fs.writeFileSync(path.join(dir, 'traces.jsonl'), `${queries.map((query) => JSON.stringify({ query })).join('\n')}\nbroken line\n`);
  });

  test('label saves after every answer and picks up where it left off', async () => {
    const first = await run(['label', '--from-logs', 'traces.jsonl', '--docs', 'docs', '--questions', '2'], ['1', '1']);

    expect(first.stderr).toBe('');
    expect(first.code).toBe(0);
    expect(first.stdout).toMatch(/4 different queries in traces\.jsonl, 4 not labelled yet\. Going through 2\./);
    // The most-asked query comes first
    expect(first.stdout).toMatch(/\[1\/2\] how do cats purr {2}\(asked 2 times\)/);
    expect(first.stdout).toMatch(/Labelled 2\. Saved to ragforge-labels\.json\./);
    expect(first.stdout).toMatch(/Next: npx ragforge eval --from-logs traces\.jsonl --docs docs/);
    expect(labelsFile().map((l) => [l.question, l.chunkId])).toEqual([['how do cats purr', 'docs/cats.md#1'], ['pizza oven heat', 'docs/pizza.md#1']]);

    const second = await run(['label', '--from-logs', 'traces.jsonl', '--docs', 'docs'], ['n', 'q']);
    expect(second.stdout).toMatch(/4 different queries in traces\.jsonl, 2 not labelled yet\. Going through 2\./);
    expect(second.stdout).toMatch(/Labelled 0, 1 with no answer in the docs\. Saved/);
    expect(labelsFile()).toHaveLength(3);
    expect(labelsFile()[2]).toEqual({ question: 'refund policy', noAnswer: true });

    await run(['label', '--from-logs', 'traces.jsonl', '--docs', 'docs'], ['1']);
    const done = await run(['label', '--from-logs', 'traces.jsonl', '--docs', 'docs']);
    expect(done.stdout).toMatch(/All 4 queries in traces\.jsonl are already labelled/);
  });

  test('eval --from-logs scores the labelled real queries', async () => {
    await run(['label', '--from-logs', 'traces.jsonl', '--docs', 'docs', '--labels', 'my-labels.json'], ['1', '1', 'n', '1']);

    const { code, stdout, stderr } = await run(['eval', '--from-logs', 'traces.jsonl', '--labels', 'my-labels.json', '--docs', 'docs', '--techniques', 'baseline,hybrid', '--json', 'r.json']);

    expect(stderr).not.toMatch(/Error/);
    expect(code).toBe(0);
    expect(stderr).toMatch(/Using 3 labelled real queries from traces\.jsonl \(4 different queries in the log, 1 with no answer in the docs, 1 unreadable lines skipped\)\./);
    expect(stderr).not.toMatch(/Generating questions/);
    expect(stdout).toMatch(/ragforge eval · 3 questions/);
    expect(stdout).toMatch(/baseline ★\s+100%/);

    const json = JSON.parse(fs.readFileSync(path.join(dir, 'r.json'), 'utf8'));
    expect(json.questions.map((q) => q.question)).toEqual(['how do cats purr', 'pizza oven heat', 'rocket thrust orbit']);
    expect(json.questions[0].expectedText).toBe(openingWords(DOCS[0].content));
    expect(json.questions[0].chunkId).toBeUndefined();

    // --questions caps how many are used
    const capped = await run(['eval', '--from-logs', 'traces.jsonl', '--labels', 'my-labels.json', '--docs', 'docs', '--techniques', 'baseline', '--questions', '2']);
    expect(capped.stderr).toMatch(/Using 2 labelled real queries/);
  });

  test('bad input is reported with exit code 1', async () => {
    fs.writeFileSync(path.join(dir, 'empty.jsonl'), 'nothing useful\n');
    fs.writeFileSync(path.join(dir, 'bad-labels.json'), '{"not":"an array"}');
    fs.writeFileSync(path.join(dir, 'q.json'), '[]');
    const cases = [
      [['label'], /--from-logs is required/],
      [['label', '--from-logs', 'traces.jsonl'], /--docs is required/],
      [['label', '--from-logs', 'missing.jsonl', '--docs', 'docs'], /--from-logs: cannot read missing\.jsonl/],
      [['label', '--from-logs', 'empty.jsonl', '--docs', 'docs'], /no queries found in empty\.jsonl/],
      [['label', '--from-logs', 'traces.jsonl', '--docs', 'docs', '--labels', 'bad-labels.json'], /is not a labels file/],
      [['eval', '--from-logs', 'traces.jsonl', '--docs', 'docs'], /None of the 4 queries in traces\.jsonl is labelled yet\. Run: ragforge label/],
      [['eval', '--from-logs', 'missing.jsonl', '--docs', 'docs'], /--from-logs: cannot read missing\.jsonl/],
      [['eval', '--from-logs', 'traces.jsonl', '--questions-file', 'q.json', '--docs', 'docs'], /--from-logs or --questions-file, not both/],
      [['eval', '--docs', 'docs', '--labels', 'x.json'], /--labels needs --from-logs/],
    ];
    for (const [args, message] of cases) {
      const { code, stderr } = await run(args);
      expect(code).toBe(1);
      expect(stderr).toMatch(message);
    }
  });
});
