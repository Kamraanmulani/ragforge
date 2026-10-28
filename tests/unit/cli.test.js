// Unit tests for the `ragforge eval` CLI (no network)

const fs = require('fs');
const os = require('os');
const path = require('path');
const { main } = require('../../src/cli');
const { createRagforge } = require('../../index');
const { createKeywordProvider } = require('./helpers');

function respond(prompt) {
  if (prompt.includes('Passage:\n')) return prompt.split('Passage:\n')[1].split('.')[0] + '?';
  return 'unrelated words';
}

function capture() {
  let text = '';
  return { write: (s) => (text += s), get text() { return text; } };
}

describe('ragforge CLI', () => {
  let dir;
  beforeEach(() => {
    dir = fs.mkdtempSync(path.join(os.tmpdir(), 'ragforge-cli-'));
    fs.mkdirSync(path.join(dir, 'docs', 'nested'), { recursive: true });
    fs.writeFileSync(path.join(dir, 'docs', 'cats.md'), 'Cats purr when content and groom their fur with rough tongues for hours.');
    fs.writeFileSync(path.join(dir, 'docs', 'nested', 'pizza.txt'), 'Pizza dough is made from flour, water, yeast and salt and baked hot.');
    fs.writeFileSync(path.join(dir, 'docs', 'image.png'), 'not text');
  });
  afterEach(() => fs.rmSync(dir, { recursive: true, force: true }));

  // Swap the real providers for the keyword fake, keep everything else
  const fakeFactory = () => createRagforge({ llm: createKeywordProvider(respond) });

  test('eval prints a scoreboard and writes HTML and JSON reports', async () => {
    const stdout = capture();
    const stderr = capture();

    const code = await main(
      ['eval', '--docs', 'docs', '--questions', '2', '--techniques', 'baseline,hyde', '--html', 'r.html', '--json', 'r.json'],
      { stdout, stderr, cwd: dir, createRagforge: fakeFactory }
    );

    expect(stderr.text).not.toMatch(/Error/);
    expect(code).toBe(0);
    expect(stdout.text).toMatch(/Recommended: baseline/);
    expect(fs.readFileSync(path.join(dir, 'r.html'), 'utf8')).toMatch(/<!doctype html>/);
    const json = JSON.parse(fs.readFileSync(path.join(dir, 'r.json'), 'utf8'));
    expect(json.questionCount).toBe(2);
    // Only text files are read, ids are relative paths with forward slashes
    expect(json.questions.map((q) => q.expectedId.split('#')[0]).sort()).toEqual(['docs/cats.md', 'docs/nested/pizza.txt']);
  });

  test('document ids stay short when docs are outside the working directory', async () => {
    const elsewhere = fs.mkdtempSync(path.join(os.tmpdir(), 'ragforge-cwd-'));
    try {
      const code = await main(
        ['eval', '--docs', path.join(dir, 'docs'), '--docs', path.join(dir, 'docs', 'cats.md'), '--questions', '3', '--techniques', 'baseline', '--json', 'r.json'],
        { stdout: capture(), stderr: capture(), cwd: elsewhere, createRagforge: fakeFactory }
      );
      expect(code).toBe(0);
      const ids = JSON.parse(fs.readFileSync(path.join(elsewhere, 'r.json'), 'utf8')).questions.map((q) => q.expectedId.split('#')[0]);
      expect(ids.every((id) => !id.includes('..'))).toBe(true);
      expect(ids).toEqual(expect.arrayContaining(['cats.md']));
    } finally {
      fs.rmSync(elsewhere, { recursive: true, force: true });
    }
  });

  test('--help exits 0, missing command exits 1', async () => {
    const stdout = capture();
    expect(await main(['--help'], { stdout })).toBe(0);
    expect(stdout.text).toMatch(/Usage: ragforge eval/);
    expect(await main([], { stdout: capture() })).toBe(1);
  });

  test('reports bad input with exit code 1', async () => {
    const cases = [
      ['eval'],
      ['eval', '--docs', 'docs', '--questions', 'abc'],
      ['eval', '--docs', 'docs', '--provider', 'nope'],
      ['eval', '--docs', 'missing-folder'],
      ['frobnicate'],
      ['eval', '--bogus-flag'],
    ];
    for (const args of cases) {
      const stderr = capture();
      expect(await main(args, { stdout: capture(), stderr, cwd: dir, createRagforge: fakeFactory })).toBe(1);
      expect(stderr.text.length).toBeGreaterThan(0);
    }
  });
});
