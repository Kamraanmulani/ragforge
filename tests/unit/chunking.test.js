// Unit tests for the chunking strategies (roadmap 7.3), no network

const fs = require('fs');
const os = require('os');
const path = require('path');
const { chunkText, chunkDocuments, CHUNK_STRATEGIES, createRagforge, loadDocuments, formatTable } = require('../../index');
const { splitSentences, markdownSections, codeUnits, checkChunking } = require('../../src/eval/chunk');
const { main } = require('../../src/cli');
const { createKeywordProvider } = require('./helpers');

const lengthsWithin = (chunks, size) => chunks.forEach((c) => expect(c.length).toBeLessThanOrEqual(size));

describe('checkChunking', () => {
  test('lists the strategies', () => {
    expect(CHUNK_STRATEGIES).toEqual(['paragraph', 'fixed', 'sentence', 'markdown-heading', 'semantic', 'code']);
  });

  test('rejects an unknown strategy, a bad size and a misplaced or too-large overlap', () => {
    expect(() => checkChunking({ strategy: 'words' })).toThrow(/Unknown chunking strategy "words".*paragraph, fixed/);
    expect(() => checkChunking({ size: 0 })).toThrow(/positive whole number/);
    expect(() => checkChunking({ strategy: 'paragraph', overlap: 50 })).toThrow(/fixed and sentence strategies, not paragraph/);
    expect(() => checkChunking({ strategy: 'fixed', size: 100, overlap: 100 })).toThrow(/smaller than the chunk size/);
    expect(checkChunking({ strategy: 'fixed', size: 100, overlap: 20 })).toEqual({ strategy: 'fixed', size: 100, overlap: 20 });
  });

  test('chunkText points semantic at chunkDocuments', () => {
    expect(() => chunkText('a. b.', { strategy: 'semantic' })).toThrow(/use chunkDocuments/);
  });
});

describe('paragraph (default)', () => {
  test('is unchanged from 2.3, so chunk ids and CI baselines stay put', () => {
    const text = 'aaa aaa\n\nbbb bbb\n\nccc ccc';
    expect(chunkText(text, { size: 16 })).toEqual(['aaa aaa bbb bbb', 'ccc ccc']);
    expect(chunkText(text, { size: 16, strategy: 'paragraph' })).toEqual(chunkText(text, { size: 16 }));
  });
});

describe('fixed', () => {
  const text = 'one two three four five six seven eight nine ten';

  test('cuts windows at word boundaries', () => {
    const chunks = chunkText(text, { strategy: 'fixed', size: 20 });
    expect(chunks).toEqual(['one two three four', 'five six seven eight', 'nine ten']);
    lengthsWithin(chunks, 20);
  });

  test('overlap repeats the end of one window, starting at a whole word', () => {
    const chunks = chunkText(text, { strategy: 'fixed', size: 20, overlap: 8 });
    expect(chunks).toEqual(['one two three four', 'four five six seven', 'seven eight nine ten']);
  });

  test('ignores paragraph breaks and hard-splits a word longer than the window', () => {
    expect(chunkText('ab cd\n\nef gh', { strategy: 'fixed', size: 100 })).toEqual(['ab cd ef gh']);
    expect(chunkText('x'.repeat(25), { strategy: 'fixed', size: 10 })).toEqual(['x'.repeat(10), 'x'.repeat(10), 'x'.repeat(5)]);
  });
});

describe('sentence', () => {
  test('splitSentences keeps version numbers, file names and abbreviations inside a sentence', () => {
    expect(splitSentences('Install v2.1 from npm. Then set e.g. the key in .env first! Done? Yes')).toEqual([
      'Install v2.1 from npm.',
      'Then set e.g. the key in .env first!',
      'Done?',
      'Yes',
    ]);
  });

  test('packs whole sentences and never cuts one', () => {
    const text = 'Alpha one is here. Bravo two is here. Charlie three is here.';
    const chunks = chunkText(text, { strategy: 'sentence', size: 40 });
    expect(chunks).toEqual(['Alpha one is here. Bravo two is here.', 'Charlie three is here.']);
  });

  test('overlap starts a chunk with the previous chunk\'s last sentence', () => {
    const chunks = chunkText('Aa aa. Bb bb. Cc cc. Dd dd.', { strategy: 'sentence', size: 14, overlap: 6 });
    expect(chunks).toEqual(['Aa aa. Bb bb.', 'Bb bb. Cc cc.', 'Cc cc. Dd dd.']);
    lengthsWithin(chunks, 14);
  });

  test('does not run a heading into the paragraph after it', () => {
    expect(chunkText('## Setup\n\nRun it. Then stop.', { strategy: 'sentence', size: 12 })).toEqual(['## Setup', 'Run it.', 'Then stop.']);
  });
});

describe('markdown-heading', () => {
  const md = [
    '# Guide',
    '',
    '## Install',
    '',
    'Run npm install ragforge.',
    '',
    '```bash',
    '# a shell comment, not a heading',
    'npm test',
    '```',
    '',
    '### Windows',
    '',
    'Use PowerShell.',
    '',
    '## Usage',
    '',
    'Call auto().',
  ].join('\n');

  test('markdownSections tracks the heading trail and skips # lines in code fences', () => {
    const sections = markdownSections(md).filter((s) => s.body.trim());
    expect(sections.map((s) => s.trail)).toEqual([['Guide', 'Install'], ['Guide', 'Install', 'Windows'], ['Guide', 'Usage']]);
    expect(sections[0].body).toMatch(/# a shell comment/);
  });

  test('one chunk per section, each starting with its trail', () => {
    const chunks = chunkText(md, { strategy: 'markdown-heading', size: 300 });
    expect(chunks).toHaveLength(3);
    expect(chunks[0]).toMatch(/^Guide > Install\nRun npm install ragforge\./);
    expect(chunks[1]).toBe('Guide > Install > Windows\nUse PowerShell.');
    expect(chunks[2]).toBe('Guide > Usage\nCall auto().');
  });

  test('a long section is split and every part keeps the trail', () => {
    const long = `## Limits\n\n${'Quotas reset monthly. '.repeat(10)}\n\n${'Teams share one pool. '.repeat(10)}`;
    const chunks = chunkText(long, { strategy: 'markdown-heading', size: 250 });
    expect(chunks.length).toBeGreaterThan(1);
    chunks.forEach((c) => expect(c.startsWith('Limits\n')).toBe(true));
    lengthsWithin(chunks, 250);
  });

  test('text without headings is chunked by paragraph', () => {
    expect(chunkText('aaa\n\nbbb', { strategy: 'markdown-heading', size: 100 })).toEqual(['aaa bbb']);
  });
});

describe('code', () => {
  const source = [
    "const fs = require('fs');",
    "const path = require('path');",
    '',
    '/**',
    ' * Adds two numbers.',
    ' */',
    'function add(a, b) {',
    '  const sum = a + b;',
    '',
    '  return sum;',
    '}',
    '',
    '@decorated',
    'class Box {',
    '  open() {}',
    '}',
    '',
    'module.exports = { add, Box };',
  ].join('\n');

  test('codeUnits splits at top-level declarations, keeping comments and decorators with them', () => {
    const units = codeUnits(source);
    expect(units).toEqual([
      "const fs = require('fs');",
      "const path = require('path');",
      '/**\n * Adds two numbers.\n */\nfunction add(a, b) {\n  const sum = a + b;\n\n  return sum;\n}',
      '@decorated\nclass Box {\n  open() {}\n}',
      'module.exports = { add, Box };',
    ]);
  });

  test('Python: decorators and docstrings stay with their def', () => {
    const py = 'import os\n\n@app.get("/")\ndef index():\n    """Home."""\n    return "hi"\n\ndef other():\n    pass\n';
    expect(codeUnits(py)).toEqual(['import os', '@app.get("/")\ndef index():\n    """Home."""\n    return "hi"', 'def other():\n    pass']);
  });

  test('packs declarations up to the size and keeps line breaks and indentation', () => {
    const chunks = chunkText(source, { strategy: 'code', size: 120 });
    expect(chunks[0]).toBe("const fs = require('fs');\n\nconst path = require('path');");
    expect(chunks.some((c) => c.includes('function add(a, b) {\n  const sum = a + b;'))).toBe(true);
    lengthsWithin(chunks, 120);
  });

  test('chunkDocuments uses code splitting for source files only', async () => {
    const chunks = await chunkDocuments(
      [
        { id: 'src/math.js', content: 'function a() {\n  return 1;\n}\n\nfunction b() {\n  return 2;\n}' },
        { id: 'README.md', content: 'function a() {\n  return 1;\n}' },
      ],
      { strategy: 'code', size: 30 }
    );
    expect(chunks.filter((c) => c.docId === 'src/math.js').map((c) => c.content)).toEqual(['function a() {\n  return 1;\n}', 'function b() {\n  return 2;\n}']);
    // Markdown falls back to paragraph chunking: whitespace collapsed
    expect(chunks.find((c) => c.docId === 'README.md').content).toBe('function a() { return 1; }');
  });
});

describe('semantic', () => {
  // A topic embedding: animals vs markets
  const embed = async (text) => (/cat|dog|purr|bark/i.test(text) ? [1, 0] : [0, 1]);
  const text = 'Cats purr softly. Dogs bark loudly. Cats nap all day. Stocks rose today. Markets fell later. Bonds held steady.';

  test('needs an embed function', async () => {
    await expect(chunkDocuments([text], { strategy: 'semantic' })).rejects.toThrow(/semantic chunking needs embeddings/);
  });

  test('splits where the topic shifts, with one embedding per sentence', async () => {
    const calls = [];
    const counting = async (t) => (calls.push(t), embed(t));
    const chunks = await chunkDocuments([text], { strategy: 'semantic', size: 200, embed: counting });
    expect(chunks.map((c) => c.content)).toEqual(['Cats purr softly. Dogs bark loudly. Cats nap all day.', 'Stocks rose today. Markets fell later. Bonds held steady.']);
    expect(calls).toHaveLength(6);
  });

  test('still respects the size limit, and does not split when nothing shifts', async () => {
    const same = async () => [1, 1];
    const chunks = await chunkDocuments([text], { strategy: 'semantic', size: 40, embed: same });
    lengthsWithin(chunks.map((c) => c.content), 40);
    const whole = await chunkDocuments([text], { strategy: 'semantic', size: 500, embed: same });
    expect(whole).toHaveLength(1);
  });
});

describe('evaluate with a chunking strategy', () => {
  const DOCS = [
    { id: 'guide.md', content: '# Guide\n\n## Billing\n\nInvoices are sent monthly by email.\n\n## Refunds\n\nRefunds take five business days.' },
  ];
  const respond = (prompt) => (prompt.includes('Passage:\n') ? `How long do refunds take?` : 'ok');

  test('splits with the strategy, embeds semantic sentences as setup cost, and reports the chunking', async () => {
    const rf = createRagforge({ llm: createKeywordProvider(respond) });
    const result = await rf.evaluate({
      documents: DOCS,
      questions: [{ question: 'How long do refunds take?', expectedText: 'five business days' }],
      techniques: ['baseline'],
      chunkStrategy: 'markdown-heading',
      topK: 1,
    });
    expect(result.chunkCount).toBe(2);
    expect(result.chunking).toEqual({ strategy: 'markdown-heading', size: 800, overlap: 0 });
    expect(result.results[0].hitRate).toBe(1);
    expect(formatTable(result)).toMatch(/2 chunks indexed \(markdown-heading, up to 800 chars\)/);
  });

  test('rejects a bad strategy before any API call', async () => {
    const llm = createKeywordProvider(respond);
    const rf = createRagforge({ llm });
    await expect(rf.evaluate({ documents: DOCS, chunkStrategy: 'nope' })).rejects.toThrow(/Unknown chunking strategy/);
    expect(llm.calls.chat).toHaveLength(0);
    expect(llm.calls.embed).toHaveLength(0);
  });

  test('semantic chunking embeds through the instance, so its usage counts toward setup', async () => {
    const llm = createKeywordProvider(respond);
    const rf = createRagforge({ llm });
    const result = await rf.evaluate({
      documents: DOCS,
      questions: [{ question: 'refunds', expectedText: 'five business days' }],
      techniques: ['baseline'],
      chunkStrategy: 'semantic',
    });
    expect(result.chunking.strategy).toBe('semantic');
    // Sentence embeddings plus chunk embeddings, all before the techniques ran
    expect(result.setup.embeddingCalls).toBeGreaterThan(result.chunkCount);
  });
});

describe('loaders and CLI', () => {
  let dir;
  beforeAll(() => {
    dir = fs.mkdtempSync(path.join(os.tmpdir(), 'ragforge-chunk-'));
    fs.mkdirSync(path.join(dir, 'src'));
    fs.mkdirSync(path.join(dir, 'dist'));
    fs.writeFileSync(path.join(dir, 'README.md'), '# Demo\n\nThe add function sums numbers.');
    fs.writeFileSync(path.join(dir, 'src', 'math.js'), 'function add(a, b) {\n  return a + b;\n}\n');
    fs.writeFileSync(path.join(dir, 'src', 'lib.min.js'), 'function x(){}');
    fs.writeFileSync(path.join(dir, 'dist', 'bundle.js'), 'function y() {}');
  });
  afterAll(() => fs.rmSync(dir, { recursive: true, force: true }));

  test('folders give source files only with code: true, skipping build output and minified files', async () => {
    const ids = async (opts) => (await loadDocuments(dir, { cwd: dir, ...opts })).map((d) => d.id).sort();
    const name = path.basename(dir);
    expect(await ids({})).toEqual([`${name}/README.md`]);
    expect(await ids({ code: true })).toEqual([`${name}/README.md`, `${name}/src/math.js`]);
  });

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

  test('--chunk-strategy and --chunk-overlap are checked before documents are read', async () => {
    const a = io();
    expect(await main(['eval', '--docs', dir, '--chunk-strategy', 'words'], { ...a, cwd: dir })).toBe(1);
    expect(a.err).toMatch(/--chunk-strategy must be one of: paragraph, fixed/);
    const b = io();
    expect(await main(['eval', '--docs', dir, '--chunk-overlap', 'some'], { ...b, cwd: dir })).toBe(1);
    expect(b.err).toMatch(/--chunk-overlap must be a whole number, 0 or more/);
    const c = io();
    expect(await main(['label', '--from-logs', 'x.jsonl', '--docs', dir, '--chunk-strategy', 'semantic'], { ...c, cwd: dir })).toBe(1);
  });

  test('eval passes the strategy through and reads code files with --chunk-strategy code', async () => {
    let seen;
    const factory = (opts) => {
      const rf = createRagforge({ ...opts, llm: createKeywordProvider(() => 'ok'), embeddings: createKeywordProvider(() => 'ok') });
      return {
        ...rf,
        evaluate: async (o) => {
          seen = o;
          return rf.evaluate(o);
        },
      };
    };
    const questions = path.join(dir, 'q.json');
    fs.writeFileSync(questions, JSON.stringify([{ question: 'add numbers', expectedText: 'return a + b' }]));
    const a = io();
    const code = await main(['eval', '--docs', dir, '--questions-file', questions, '--techniques', 'baseline', '--chunk-strategy', 'code'], { ...a, cwd: dir, createRagforge: factory });
    expect(a.err).not.toMatch(/Error/);
    expect(code).toBe(0);
    expect(seen).toMatchObject({ chunkStrategy: 'code' });
    expect(seen.documents.map((d) => d.id)).toContain(`${path.basename(dir)}/src/math.js`);
    expect(a.out).toMatch(/chunks indexed \(code, up to 800 chars\)/);
  });
});

describe('MCP server', () => {
  const { startMcpServer } = require('../../src/mcp/server');

  test('refuses semantic chunking without embeddings before it starts serving', async () => {
    await expect(startMcpServer({ documents: [{ id: 'a.md', content: 'x' }], chunkStrategy: 'semantic' })).rejects.toThrow(/semantic chunking needs embeddings/);
    await expect(startMcpServer({ documents: [{ id: 'a.md', content: 'x' }], chunkStrategy: 'nope' })).rejects.toThrow(/Unknown chunking strategy/);
  });
});

describe('questions replayed across strategies', () => {
  const { matchText } = require('../../src/eval/evaluate');
  const { openingWords } = require('../../src/eval/label');
  const md = '# Guide\n\n## Install\n\nRun npm install ragforge first.\n\n### Windows\n\nUse PowerShell and set the PATH variable before you start.';

  test('matchText ignores heading marks, trail separators and whitespace, but keeps C#', () => {
    expect(matchText('Guide > Install\nRun  npm')).toBe('guide install run npm');
    expect(matchText('# Guide ## Install Run npm')).toBe('guide install run npm');
    expect(matchText('C# generics')).toBe('c# generics');
  });

  test('a passage remembered under one strategy is found under every other', async () => {
    for (const from of ['paragraph', 'markdown-heading', 'sentence', 'code']) {
      const remembered = (await chunkDocuments([{ id: 'guide.md', content: md }], { strategy: from, size: 60 })).find((c) => /PowerShell/.test(c.content));
      const expectedText = openingWords(require('../../src/eval/chunk').passageText(remembered), 6);
      for (const to of ['paragraph', 'markdown-heading', 'sentence', 'fixed']) {
        const chunks = await chunkDocuments([{ id: 'guide.md', content: md }], { strategy: to, size: 400 });
        expect([from, to, chunks.some((c) => matchText(c.content).includes(matchText(expectedText)))]).toEqual([from, to, true]);
      }
    }
  });

  test('generated questions from heading chunks remember the passage without its trail', async () => {
    const rf = createRagforge({ llm: createKeywordProvider((p) => (p.includes('Passage:\n') ? 'How do I set PATH on Windows?' : 'ok')) });
    const result = await rf.evaluate({ documents: [{ id: 'guide.md', content: md }], numQuestions: 1, techniques: ['baseline'], chunkStrategy: 'markdown-heading' });
    expect(result.questions[0].source).toMatch(/^Run npm install|^Use PowerShell/);
  });
});
