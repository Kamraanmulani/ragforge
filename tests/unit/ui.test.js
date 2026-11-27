// Unit tests for `ragforge ui` (roadmap 7.6): file discovery, the JSON API, its security
// rules, live search, the CLI command and the page itself. No network.

const fs = require('fs');
const os = require('os');
const path = require('path');
const http = require('http');
const { createRagforge } = require('../../index');
const { startUiServer, createCatalog, classify, questionChanges } = require('../../src/ui/server');
const { renderApp } = require('../../src/ui/app');
const { syncIndex } = require('../../src/indexing/persistentIndex');
const { main } = require('../../src/cli');
const { createKeywordProvider, keywordVector } = require('./helpers');

const tmpDirs = [];
function tmp() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'ragforge-ui-'));
  tmpDirs.push(dir);
  return dir;
}
afterAll(() => tmpDirs.forEach((d) => fs.rmSync(d, { recursive: true, force: true })));

const evalResult = (questions, hit = 1) => ({
  topK: 3,
  questionCount: questions.length,
  techniques: ['baseline', 'hybrid'],
  results: [
    { technique: 'baseline', hitRate: hit, mrr: hit, avgLatencyMs: 10, avgCostUSD: 0.000001, totalCostUSD: 0.00001, avgLlmCalls: 0, errors: 0 },
    { technique: 'hybrid', hitRate: 1, mrr: 1, avgLatencyMs: 12, avgCostUSD: 0.000001, totalCostUSD: 0.00001, avgLlmCalls: 0, errors: 0 },
  ],
  ranking: ['hybrid', 'baseline'],
  best: 'hybrid',
  recommendation: { technique: 'hybrid', reason: 'Better.' },
  provider: { llm: 'openai', chatModel: 'gpt-4o-mini', embeddings: 'openai', embeddingModel: 'text-embedding-3-small' },
  setup: { costUSD: 0.0001 },
  questions: questions.map((q, i) => ({ question: q, expectedText: `text ${i}`, runs: { baseline: { rank: hit === 1 ? 1 : i === 0 ? 0 : 1, retrieved: ['a#1'] }, hybrid: { rank: 1, retrieved: ['a#1'] } } })),
});

async function project() {
  const dir = tmp();
  fs.mkdirSync(path.join(dir, 'runs'));
  fs.writeFileSync(path.join(dir, 'runs', 'main.json'), JSON.stringify(evalResult(['How long do refunds take?', 'Support hours?'])));
  fs.writeFileSync(path.join(dir, 'runs', 'branch.json'), JSON.stringify(evalResult(['How long do refunds take?', 'Support hours?'], 0.5)));
  fs.writeFileSync(path.join(dir, 'tune.json'), JSON.stringify({
    version: 1, topK: 5, questionCount: 2, budgetUSD: 0.5, spent: { costUSD: 0.01 }, stopped: null, warnings: [], best: 'p/800/m baseline', default: 'p/800/m baseline', reason: 'Default kept.', pareto: ['p/800/m baseline'],
    trials: [{ id: 'p/800/m baseline', setupId: 'p/800/m', setup: {}, isDefault: true, technique: 'baseline', stage: 'screen', hitRate: 0.5, mrr: 0.5, avgCostUSD: 0.000001, avgLatencyMs: 5, avgLlmCalls: 0, errors: 0, indexCostUSD: 0.0001, avgChunkChars: 600 }],
    config: { version: 1, chunking: { strategy: 'paragraph', size: 800, overlap: 0 }, technique: 'baseline' },
  }));
  fs.writeFileSync(path.join(dir, 'ragforge.config.json'), JSON.stringify({ version: 1, chunking: { strategy: 'sentence', size: 800, overlap: 0 }, technique: 'hybrid', topK: 5 }));
  fs.writeFileSync(path.join(dir, 'traces.jsonl'), [JSON.stringify({ timestamp: '2026-11-01T00:00:00Z', type: 'auto', query: 'refunds?', route: { technique: 'hyde' }, sources: [], stats: { costUSD: 0.001, latencyMs: 900 } }), '{ broken', JSON.stringify({ question: 'old-style log line' })].join('\n'));
  fs.writeFileSync(path.join(dir, 'package.json'), JSON.stringify({ name: 'not-a-result' }));
  fs.writeFileSync(path.join(dir, 'bad.json'), '{ nope');
  fs.mkdirSync(path.join(dir, 'node_modules', 'x'), { recursive: true });
  fs.writeFileSync(path.join(dir, 'node_modules', 'x', 'eval.json'), JSON.stringify(evalResult(['hidden'])));
  fs.mkdirSync(path.join(dir, '.git'));
  fs.writeFileSync(path.join(dir, '.git', 'eval.json'), JSON.stringify(evalResult(['hidden'])));
  // Two saved indexes: keyword-only, and with (keyword) embeddings
  const docs = [{ id: 'billing.md', content: 'Refunds take five business days.\n\nInvoices arrive on day one.' }, { id: 'hooks.md', content: 'Webhooks retry three times with backoff.' }];
  await syncIndex({ documents: docs, dir: path.join(dir, '.ragforge', 'index'), chunking: { size: 40 } });
  await syncIndex({ documents: docs, dir: path.join(dir, 'vectors'), chunking: { size: 40 }, embed: async (t) => keywordVector(t), embeddings: 'keyword:text-embedding-3-small' });
  return dir;
}

// Raw HTTP, so the Host and Origin headers can be set the way a browser (or an attacker) would
function request(port, { method = 'GET', path: p = '/', headers = {}, body } = {}) {
  return new Promise((resolve, reject) => {
    const req = http.request({ host: '127.0.0.1', port, method, path: p, headers: { host: `127.0.0.1:${port}`, ...headers } }, (res) => {
      let data = '';
      res.on('data', (d) => (data += d));
      res.on('end', () => {
        let json = null;
        try {
          json = JSON.parse(data);
        } catch {}
        resolve({ status: res.statusCode, headers: res.headers, text: data, json });
      });
    });
    req.on('error', reject);
    if (body !== undefined) req.write(typeof body === 'string' ? body : JSON.stringify(body));
    req.end();
  });
}
const post = (port, body, headers = {}) => request(port, { method: 'POST', path: '/api/search', headers: { 'content-type': 'application/json', ...headers }, body });

describe('classify and the catalog', () => {
  test('recognises each kind of file by its shape', () => {
    expect(classify(evalResult(['q']), 'x.json')).toBe('eval');
    expect(classify({ trials: [], pareto: [], config: {} }, 'x.json')).toBe('tune');
    expect(classify({ settings: {}, documents: {}, chunkCount: 1 }, 'manifest.json')).toBe('index');
    expect(classify({ settings: {}, documents: {}, chunkCount: 1 }, 'other.json')).toBeNull();
    expect(classify({ version: 1, chunking: {}, technique: 'hybrid' }, 'c.json')).toBe('config');
    expect(classify({ name: 'pkg' }, 'package.json')).toBeNull();
    expect(classify([1, 2], 'a.json')).toBeNull();
  });

  test('finds results below the folder, skipping node_modules, hidden folders, index chunks and other JSON', async () => {
    const dir = await project();
    const files = createCatalog(dir).scan();
    expect(files.map((f) => `${f.kind} ${f.id}`).sort()).toEqual([
      'config ragforge.config.json',
      'eval runs/branch.json',
      'eval runs/main.json',
      'index .ragforge/index/manifest.json',
      'index vectors/manifest.json',
      'traces traces.jsonl',
      'tune tune.json',
    ]);
    const main = files.find((f) => f.id === 'runs/main.json');
    expect(main.summary).toMatchObject({ questions: 2, topK: 3, techniques: 2, recommended: 'hybrid', best: 1 });
    expect(files.find((f) => f.kind === 'traces').summary).toEqual({ traces: 2 });
    expect(files.find((f) => f.id === '.ragforge/index/manifest.json').summary).toMatchObject({ chunks: 3, documents: 2, embeddings: null });
  });

  test('questionChanges lists the questions whose rank moved, by technique', () => {
    const before = evalResult(['a', 'b']);
    // The fixture misses its first question ('b') with baseline at hit 0.5
    const after = evalResult(['b', 'a', 'new'], 0.5);
    expect(questionChanges(before, after)).toEqual({ shared: 2, changes: [{ question: 'b', technique: 'baseline', before: 1, after: 0, change: 'worse' }] });
  });
});

describe('server', () => {
  let dir;
  let ui;
  let embedder;
  beforeAll(async () => {
    dir = await project();
    embedder = createKeywordProvider(() => 'unused');
    ui = await startUiServer({ dir, port: 0, createProvider: () => embedder, createRagforge });
  });
  afterAll(() => ui.close());

  test('serves the page with a strict, per-response content security policy', async () => {
    const res = await request(ui.port);
    expect(res.status).toBe(200);
    expect(res.headers['content-type']).toMatch(/text\/html/);
    const csp = res.headers['content-security-policy'];
    const nonce = /script-src 'nonce-([^']+)'/.exec(csp)[1];
    expect(csp).toMatch(/default-src 'none'/);
    expect(res.text).toContain(`<script nonce="${nonce}">`);
    expect(res.headers['x-frame-options']).toBe('DENY');
    expect(res.headers['x-content-type-options']).toBe('nosniff');
    const again = await request(ui.port);
    expect(again.headers['content-security-policy']).not.toBe(csp);
    expect(ui.url).toBe(`http://127.0.0.1:${ui.port}`);
  });

  test('refuses requests addressed to another host name (DNS rebinding)', async () => {
    const res = await request(ui.port, { path: '/api/files', headers: { host: `evil.example:${ui.port}` } });
    expect(res.status).toBe(403);
    expect((await request(ui.port, { path: '/api/files', headers: { host: `localhost:${ui.port}` } })).status).toBe(200);
  });

  test('lists the files and returns one by its id; nothing outside the list can be read', async () => {
    const list = await request(ui.port, { path: '/api/files' });
    expect(list.json.root).toBe(dir);
    expect(list.json.files).toHaveLength(7);

    const run = await request(ui.port, { path: '/api/file?path=runs%2Fmain.json' });
    expect(run.json).toMatchObject({ kind: 'eval', id: 'runs/main.json', data: { topK: 3 } });
    expect(run.json).not.toHaveProperty('full');

    for (const p of ['..%2F..%2Fetc%2Fpasswd', encodeURIComponent(path.join(dir, 'runs', 'main.json')), 'package.json', 'bad.json', 'node_modules%2Fx%2Feval.json', '.git%2Feval.json', 'vectors%2Fchunks.json', '']) {
      expect([p, (await request(ui.port, { path: `/api/file?path=${p}` })).status]).toEqual([p, 404]);
    }
  });

  test('tune runs come with their chart; trace logs with their counts', async () => {
    const tune = await request(ui.port, { path: '/api/file?path=tune.json' });
    expect(tune.json.chart).toMatch(/^<svg viewBox="0 0 640 320"/);
    const traces = await request(ui.port, { path: '/api/file?path=traces.jsonl' });
    expect(traces.json).toMatchObject({ kind: 'traces', total: 2, shown: 2, skipped: 1 });
    expect(traces.json.data[1].query).toBe('old-style log line');
  });

  test('a file written while the dashboard is open shows up', async () => {
    fs.writeFileSync(path.join(dir, 'runs', 'later.json'), JSON.stringify(evalResult(['q'])));
    const list = await request(ui.port, { path: '/api/files' });
    expect(list.json.files.some((f) => f.id === 'runs/later.json')).toBe(true);
    fs.rmSync(path.join(dir, 'runs', 'later.json'));
  });

  test('compares two eval runs, with the questions that changed', async () => {
    const res = await request(ui.port, { path: '/api/compare?a=runs%2Fmain.json&b=runs%2Fbranch.json&failOnDrop=10' });
    expect(res.status).toBe(200);
    const baseline = res.json.comparison.rows.find((r) => r.technique === 'baseline');
    expect(baseline).toMatchObject({ status: 'regressed', hitRate: { before: 1, after: 0.5, delta: -0.5 } });
    expect(res.json.comparison.passed).toBe(false);
    expect(res.json.questions.changes).toEqual([{ question: 'How long do refunds take?', technique: 'baseline', before: 1, after: 0, change: 'worse' }]);
    expect((await request(ui.port, { path: '/api/compare?a=runs%2Fmain.json&b=tune.json' })).status).toBe(404);
    expect((await request(ui.port, { path: '/api/compare?a=runs%2Fmain.json&b=runs%2Fbranch.json&failOnDrop=-1' })).status).toBe(400);
  });

  test('search: keyword on a keyword-only index, hybrid and baseline with the index model', async () => {
    const keyword = await post(ui.port, { index: '.ragforge/index/manifest.json', query: 'webhooks retry', technique: 'hybrid' });
    expect(keyword.status).toBe(200);
    // A keyword-only index can only be keyword-searched, whatever was asked
    expect(keyword.json).toMatchObject({ technique: 'keyword', results: [expect.objectContaining({ ref: 1, id: 'hooks.md#1', content: 'Webhooks retry three times with backoff.' })] });

    const hybrid = await post(ui.port, { index: 'vectors/manifest.json', query: 'Refunds business days', technique: 'hybrid', topK: 1 });
    expect(hybrid.json).toMatchObject({ technique: 'hybrid', results: [{ id: 'billing.md#1', score: null }] });
    expect(hybrid.json.stats.embeddingCalls).toBe(1);
    const baseline = await post(ui.port, { index: 'vectors/manifest.json', query: 'Refunds business days', technique: 'baseline', topK: 1 });
    expect(baseline.json.results[0]).toMatchObject({ id: 'billing.md#1', score: expect.any(Number) });
    // Search never asks the chat model
    expect(embedder.calls.chat).toHaveLength(0);
  });

  test('search refuses cross-site requests, non-JSON bodies, and bad input', async () => {
    const before = embedder.calls.embed.length;
    expect((await post(ui.port, { index: 'vectors/manifest.json', query: 'x' }, { origin: 'https://evil.example' })).status).toBe(403);
    expect((await post(ui.port, { index: 'vectors/manifest.json', query: 'x' }, { 'content-type': 'text/plain' })).status).toBe(403);
    expect(embedder.calls.embed.length).toBe(before);
    expect((await post(ui.port, { index: 'vectors/manifest.json', query: 'x' }, { origin: `http://localhost:${ui.port}` })).status).toBe(200);
    expect((await post(ui.port, { index: 'vectors/manifest.json', query: '  ' })).json).toEqual({ error: 'Type a query' });
    expect((await post(ui.port, { index: 'runs/main.json', query: 'x' })).status).toBe(404);
    expect((await post(ui.port, '{ nope')).status).toBe(400);
    expect((await request(ui.port, { method: 'DELETE', path: '/api/files' })).status).toBe(405);
  });

  test('an index built with another embedding model is reported, not searched wrongly', async () => {
    const other = await startUiServer({ dir, port: 0, createProvider: () => ({ ...createKeywordProvider(() => ''), embeddingModel: 'other-model' }), createRagforge });
    try {
      const res = await post(other.port, { index: 'vectors/manifest.json', query: 'refunds' });
      expect(res.status).toBe(500);
      expect(res.json.error).toMatch(/built with embeddings keyword:text-embedding-3-small, but this instance uses keyword:other-model/);
    } finally {
      await other.close();
    }
  });
});

describe('the page', () => {
  test('its script parses, and data is only ever inserted as text', () => {
    const html = renderApp({ nonce: 'n0nce' });
    const script = html.slice(html.indexOf('<script nonce="n0nce">') + 22, html.lastIndexOf('</script>'));
    expect(() => new Function(script)).not.toThrow();
    // The one innerHTML is the server-built tune chart
    expect(script.match(/innerHTML/g)).toHaveLength(1);
    expect(script).toMatch(/chart\.innerHTML = file\.chart/);
    expect(script).not.toMatch(/insertAdjacentHTML|outerHTML|document\.write/);
    expect(html).toContain('<style nonce="n0nce">');
  });
});

describe('CLI', () => {
  function io() {
    let out = '';
    let err = '';
    return { stdout: { write: (s) => (out += s) }, stderr: { write: (s) => (err += s) }, get out() { return out; }, get err() { return err; } };
  }

  test('ui serves until stopped and says what it found', async () => {
    const dir = await project();
    const a = io();
    const controller = new AbortController();
    let ui;
    const running = main(['ui', '--dir', dir, '--port', '0'], { ...a, signal: controller.signal, onListening: (u) => (ui = u) });
    try {
      for (let i = 0; i < 100 && !ui; i++) await new Promise((r) => setTimeout(r, 20));
      expect(a.out).toMatch(/^ragforge ui: http:\/\/127\.0\.0\.1:\d+\n/);
      expect(a.out).toMatch(/2 eval runs, 1 tune run, 1 trace log, 2 saved indexes, 1 tuned config\./);
      expect((await request(ui.port, { path: '/api/files' })).json.files).toHaveLength(7);
    } finally {
      controller.abort();
    }
    expect(await running).toBe(0);
  });

  test('bad options fail clearly', async () => {
    const a = io();
    expect(await main(['ui', '--dir', path.join(tmp(), 'missing')], a)).toBe(1);
    expect(a.err).toMatch(/is not a folder/);
    const b = io();
    expect(await main(['ui', '--port', 'abc'], b)).toBe(1);
    expect(b.err).toMatch(/--port must be a whole number/);
    const c = io();
    expect(await main(['ui', '--port', '70000'], c)).toBe(1);
    expect(c.err).toMatch(/--port must be 65535 or less/);
  });

  test('a port you chose that is taken is an error; the default moves to the next free one', async () => {
    const dir = tmp();
    const first = await startUiServer({ dir, port: 0 });
    try {
      await expect(startUiServer({ dir, port: first.port })).rejects.toThrow(new RegExp(`port ${first.port} is in use`));
    } finally {
      await first.close();
    }
  });
});
