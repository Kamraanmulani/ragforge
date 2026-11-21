// Unit tests for `ragforge chat` and `ragforge init` (no network)

const fs = require('fs');
const os = require('os');
const path = require('path');
const vm = require('vm');
const { PassThrough } = require('stream');
const { main } = require('../../src/cli');
const { createRagforge } = require('../../index');
const { init, mergePackageJson, TEMPLATES } = require('../../src/init');
const { GOLDEN, SAMPLE_DOC } = require('../../src/init/templates');
const { version } = require('../../package.json');
const { createKeywordProvider } = require('./helpers');

const capture = () => {
  let text = '';
  return { write: (s) => (text += s), get text() { return text; } };
};

function typed(lines) {
  const input = new PassThrough();
  input.end(lines.map((l) => `${l}\n`).join(''));
  return input;
}

let dir;
beforeEach(() => {
  dir = fs.mkdtempSync(path.join(os.tmpdir(), 'ragforge-scaffold-'));
});
afterEach(() => fs.rmSync(dir, { recursive: true, force: true }));

const read = (name) => fs.readFileSync(path.join(dir, name), 'utf8');
const exists = (name) => fs.existsSync(path.join(dir, name));

describe('ragforge chat', () => {
  beforeEach(() => {
    fs.mkdirSync(path.join(dir, 'docs'));
    fs.writeFileSync(path.join(dir, 'docs', 'cats.md'), 'Cats purr when content and groom their fur with rough tongues for hours.');
    fs.writeFileSync(path.join(dir, 'docs', 'pizza.md'), 'Pizza dough is made from flour, water, yeast and salt and baked hot.');
  });

  const chat = async (args, lines, respond = () => 'Cats purr when they are content [1].') => {
    const stdout = capture();
    const stderr = capture();
    const llm = createKeywordProvider(respond);
    const code = await main(['chat', ...args], { stdout, stderr, cwd: dir, stdin: typed(lines), createRagforge: () => createRagforge({ llm }) });
    return { code, stdout: stdout.text, stderr: stderr.text, llm };
  };

  test('answers each question from the docs and shows the cited sources', async () => {
    const { code, stdout, stderr, llm } = await chat(['--docs', 'docs', '--top-k', '2'], ['', 'why do cats purr', 'exit', 'never asked']);

    expect(code).toBe(0);
    expect(stderr).toMatch(/Indexed 2 passages from 2 document\(s\) with openai\. Ask a question, or type exit\./);
    expect(stdout).toMatch(/Cats purr when they are content \[1\]\./);
    expect(stdout).toMatch(/Sources:\n {2}\[1\] docs\/cats\.md#1 {2}Cats purr when content/);
    // Only the cited passage is listed
    expect(stdout).not.toMatch(/\[2\] docs\/pizza\.md/);
    expect(stdout).toMatch(/\(\w[\w+]* · \d+ LLM calls? · \S+ · \d+ms\)/);
    // The answer was written from the retrieved passages, and nothing after "exit" was asked
    const answers = llm.calls.chat.filter((c) => c.prompt.includes('Context passages:'));
    expect(answers).toHaveLength(1);
    expect(answers[0].prompt).toContain('[1] Cats purr when content');
    expect(llm.calls.chat.some((c) => c.prompt.includes('never asked'))).toBe(false);
  });

  test('lists every passage when the answer cites none, and keeps going after an error', async () => {
    let calls = 0;
    const respond = (prompt) => {
      if (!prompt.includes('Context passages:')) return 'ok';
      if (++calls === 1) throw new Error('rate limited');
      return 'I am not sure.';
    };
    const { code, stdout } = await chat(['--docs', 'docs', '--top-k', '2'], ['first question about cats', 'pizza dough'], respond);

    expect(code).toBe(0);
    expect(stdout).toMatch(/Error: rate limited/);
    expect(stdout).toMatch(/I am not sure\./);
    expect(stdout).toMatch(/Sources \(none cited\):\n {2}\[1\] docs\/pizza\.md#1/);
    expect(stdout).toMatch(/\[2\] docs\/cats\.md#1/);
  });

  test('bad input is reported with exit code 1', async () => {
    const cases = [
      [[], /--docs is required/],
      [['--docs', 'missing'], /No readable documents found|ENOENT|not found/i],
      [['--docs', 'docs', '--provider', 'local'], /chat needs a chat model, and local has none/],
      [['--docs', 'docs', '--provider', 'anthropic'], /anthropic has no embeddings API/],
    ];
    for (const [args, message] of cases) {
      const { code, stderr } = await chat(args, []);
      expect(code).toBe(1);
      expect(stderr).toMatch(message);
    }
  });
});

describe('ragforge init', () => {
  const cli = async (args) => {
    const stdout = capture();
    const stderr = capture();
    const code = await main(['init', ...args], { stdout, stderr, cwd: dir });
    return { code, stdout: stdout.text, stderr: stderr.text };
  };

  test('express: writes a server, sample docs, golden questions and a CI workflow', async () => {
    const { code, stdout, stderr } = await cli([]);

    expect(stderr).toBe('');
    expect(code).toBe(0);
    for (const name of ['server.js', 'rag.js', 'docs/acme-notes.md', 'golden.json', '.env.example', '.github/workflows/rag-eval.yml', 'package.json']) {
      expect(exists(name)).toBe(true);
      expect(stdout).toContain(`created  ${name}`);
    }
    expect(stdout).toMatch(/Next:\n {2}cp \.env\.example \.env/);
    expect(stdout).not.toMatch(/\n {2}cd /);

    const pkg = JSON.parse(read('package.json'));
    expect(pkg).toMatchObject({ private: true, scripts: { start: 'node server.js', chat: 'ragforge chat --docs ./docs' }, dependencies: { ragforge: `^${version}` } });
    expect(pkg.dependencies.express).toBeDefined();
    expect(pkg.scripts.eval).toMatch(/--questions-file golden\.json .*--compare ragforge-baseline\.json --fail-on-drop 3/);
    expect(pkg.scripts['eval:baseline']).toMatch(/--json ragforge-baseline\.json/);
    expect(read('.github/workflows/rag-eval.yml')).toMatch(/npm run eval\n/);
    expect(read('.env.example')).toMatch(/^OPENAI_API_KEY=$/m);

    // The generated code parses, and uses the pieces it promises
    expect(() => new vm.Script(read('server.js'))).not.toThrow();
    expect(() => new vm.Script(read('rag.js'))).not.toThrow();
    expect(read('rag.js')).toMatch(/onTrace: "traces\.jsonl"/);
    expect(read('server.js')).toMatch(/app\.post\("\/ask"/);
  });

  test('every golden question points at text that is in the sample doc', () => {
    expect(GOLDEN.length).toBeGreaterThanOrEqual(5);
    const doc = SAMPLE_DOC.replace(/\s+/g, ' ').toLowerCase();
    for (const q of GOLDEN) expect(doc).toContain(q.expectedText.toLowerCase());
  });

  test('the scaffolded eval scripts run on the sample docs', async () => {
    await cli([]);
    const { scripts } = JSON.parse(read('package.json'));
    const run = async (script) => {
      const stdout = capture();
      const stderr = capture();
      // The script as cmd passes it on Windows: commas in arguments become spaces
      const args = script.replace(/^ragforge /, '').replace(/,/g, ' ').match(/"[^"]*"|\S+/g);
      const merged = [];
      for (const a of args) (a.startsWith('--') || !merged.length || merged[merged.length - 1].startsWith('--') ? merged.push(a) : (merged[merged.length - 1] += ` ${a}`));
      const code = await main(merged, { stdout, stderr, cwd: dir, createRagforge: () => createRagforge({ llm: createKeywordProvider(() => 'ok') }) });
      return { code, stdout: stdout.text, stderr: stderr.text };
    };

    const baseline = await run(scripts['eval:baseline']);
    expect(baseline.stderr).not.toMatch(/Error/);
    expect(baseline.code).toBe(0);
    expect(baseline.stdout).toMatch(/5 questions/);
    expect(JSON.parse(read('ragforge-baseline.json')).results.find((r) => r.technique === 'hybrid').hitRate).toBe(1);

    const check = await run(scripts.eval);
    expect(check.code).toBe(0);
    expect(check.stdout).toMatch(/✓ No regression/);
  });

  test('a second run keeps existing files; --force overwrites them', async () => {
    await cli([]);
    fs.writeFileSync(path.join(dir, 'server.js'), '// mine');

    const again = await cli([]);
    expect(again.stdout).toContain('kept     server.js');
    expect(again.stdout).toContain('kept     package.json');
    expect(again.stdout).toMatch(/Use --force to overwrite them\./);
    expect(again.stdout).not.toMatch(/docs\/ already has files/);
    expect(read('server.js')).toBe('// mine');

    const forced = await cli(['--force']);
    expect(forced.stdout).toContain('created  server.js');
    expect(read('server.js')).toMatch(/express/);
  });

  test('an existing package.json only gains what it lacks', async () => {
    const mine = { name: 'my-app', version: '3.1.0', scripts: { start: 'node index.js', test: 'jest' }, dependencies: { express: '^5.0.0' }, devDependencies: { ragforge: '^2.0.0' } };
    fs.writeFileSync(path.join(dir, 'package.json'), JSON.stringify(mine));

    const { stdout } = await cli([]);
    const pkg = JSON.parse(read('package.json'));

    expect(pkg).toMatchObject({ name: 'my-app', version: '3.1.0', scripts: { start: 'node index.js', test: 'jest' }, dependencies: { express: '^5.0.0' }, devDependencies: { ragforge: '^2.0.0' } });
    expect(pkg.dependencies.ragforge).toBeUndefined();
    expect(pkg.scripts.eval).toBeDefined();
    expect(stdout).toMatch(/updated {2}package\.json \(added scripts\.eval:baseline, scripts\.eval, scripts\.chat\)/);

    expect(mergePackageJson({ scripts: { eval: 'x' } }, { scripts: { eval: 'y', chat: 'z' } })).toEqual({ pkg: { scripts: { eval: 'x', chat: 'z' } }, added: ['scripts.chat'], kept: ['scripts.eval'] });
  });

  test('a project with its own docs gets no sample doc and no sample questions', async () => {
    fs.mkdirSync(path.join(dir, 'docs'));
    fs.writeFileSync(path.join(dir, 'docs', 'handbook.md'), 'Our real handbook.');

    const { stdout } = await cli([]);

    expect(exists('docs/acme-notes.md')).toBe(false);
    expect(exists('golden.json')).toBe(false);
    expect(exists('server.js')).toBe(true);
    expect(stdout).toMatch(/docs\/ already has files, so the sample document and its golden\.json were not written\./);
  });

  test('next: writes an App Router route, under src/ when the project uses it', async () => {
    const { code, stdout } = await cli(['web app', '--template', 'next']);
    expect(code).toBe(0);
    expect(exists('web app/app/api/ask/route.js')).toBe(true);
    expect(exists('web app/lib/rag.js')).toBe(true);
    expect(exists('web app/server.js')).toBe(false);
    expect(stdout).toMatch(/Next\.js App Router route at \/api\/ask in web app/);
    expect(stdout).toMatch(/\n {2}cd "web app"\n/);
    const pkg = JSON.parse(read('web app/package.json'));
    expect(pkg.name).toBe('web-app');
    expect(pkg.scripts.dev).toBe('next dev');
    expect(pkg.dependencies).toMatchObject({ next: expect.any(String), react: expect.any(String), ragforge: `^${version}` });

    const route = read('web app/app/api/ask/route.js');
    expect(route).toMatch(/from "\.\.\/\.\.\/\.\.\/lib\/rag\.js"/);
    expect(route).toMatch(/export const runtime = "nodejs"/);
    expect(route).toMatch(/export async function POST/);
    expect(read('web app/lib/rag.js')).toMatch(/export async function ask/);
    // Both files are valid ES modules
    for (const name of ['web app/app/api/ask/route.js', 'web app/lib/rag.js']) expect(() => new vm.SourceTextModule(read(name))).not.toThrow();

    fs.mkdirSync(path.join(dir, 'site', 'src', 'app'), { recursive: true });
    await cli(['site', '--template', 'next']);
    expect(exists('site/src/app/api/ask/route.js')).toBe(true);
    expect(exists('site/src/lib/rag.js')).toBe(true);
    expect(exists('site/app')).toBe(false);
  });

  test('bad input is reported with exit code 1', async () => {
    const unknown = await cli(['--template', 'django']);
    expect(unknown.code).toBe(1);
    expect(unknown.stderr).toMatch(/Unknown template "django"\. Use one of: express, next/);
    expect(fs.readdirSync(dir)).toEqual([]);

    fs.writeFileSync(path.join(dir, 'package.json'), '{ broken');
    const broken = await cli([]);
    expect(broken.code).toBe(1);
    expect(broken.stderr).toMatch(/package\.json is not valid JSON/);

    expect(() => init({ dir, template: 'nope' })).toThrow(/Unknown template/);
    expect(Object.keys(TEMPLATES)).toEqual(['express', 'next']);
  });
});

describe('list options', () => {
  test('--techniques accepts spaces as well as commas', async () => {
    fs.mkdirSync(path.join(dir, 'docs'));
    fs.writeFileSync(path.join(dir, 'docs', 'cats.md'), 'Cats purr when content and groom their fur with rough tongues for hours.');
    const respond = (prompt) => (prompt.includes('Passage:\n') ? `${prompt.split('Passage:\n')[1].split('.')[0]}?` : 'ok');
    const stdout = capture();
    const code = await main(['eval', '--docs', 'docs', '--questions', '1', '--techniques', 'baseline hybrid, hyde', '--question-styles', 'question keywords'], {
      stdout,
      stderr: capture(),
      cwd: dir,
      createRagforge: () => createRagforge({ llm: createKeywordProvider(respond) }),
    });

    expect(code).toBe(0);
    for (const technique of ['baseline', 'hybrid', 'hyde']) expect(stdout.text).toMatch(new RegExp(`^${technique}\\b`, 'm'));
  });
});
