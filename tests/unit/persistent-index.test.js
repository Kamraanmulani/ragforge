// Unit tests for the saved, incremental index and --watch (roadmap 7.4), no network

const fs = require('fs');
const os = require('os');
const path = require('path');
const { PassThrough } = require('stream');
const { createRagforge } = require('../../index');
const { syncIndex, readIndex, encodeVector, decodeVector, summary, embeddingsId } = require('../../src/indexing/persistentIndex');
const { watchSources, ignored } = require('../../src/indexing/watch');
const { startMcpServer } = require('../../src/mcp/server');
const { main } = require('../../src/cli');
const { createKeywordProvider, keywordVector } = require('./helpers');

const tmpDirs = [];
function tmp() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'ragforge-index-'));
  tmpDirs.push(dir);
  return dir;
}
afterAll(() => tmpDirs.forEach((d) => fs.rmSync(d, { recursive: true, force: true })));

const until = async (check, ms = 8000) => {
  const end = Date.now() + ms;
  while (Date.now() < end) {
    if (await check()) return true;
    await new Promise((r) => setTimeout(r, 50));
  }
  throw new Error('timed out waiting');
};

// The loaders skip empty files, so the CLI and MCP see 2 of these 3 documents.
// Paragraphs of ~40 characters with size 50: one chunk per paragraph
const SIZE = 50;
const DOCS = () => [
  { id: 'guide.md', content: 'Install the package with npm first.\n\nSet the API key in your env file.\n\nRun the eval command on your docs.' },
  { id: 'faq.md', content: 'Refunds take five business days.\n\nInvoices arrive on the first day.' },
  { id: 'empty.md', content: '' },
];

// A counting embedder: what gets embedded, and a real (keyword) vector
function embedder() {
  const texts = [];
  return { texts, embed: async (text) => (texts.push(text), keywordVector(text)) };
}
const sync = (dir, documents, e, extra = {}) => syncIndex({ documents, dir, chunking: { size: SIZE }, embed: e.embed, embeddings: 'test:model-a', ...extra });

describe('vector encoding', () => {
  test('base64 Float32 round-trips to float precision, and empty stays empty', () => {
    const v = [0.1, -2.5, 3.25, 1e-3];
    const back = decodeVector(encodeVector(v));
    back.forEach((x, i) => expect(x).toBeCloseTo(v[i], 6));
    expect(decodeVector(encodeVector([]))).toEqual([]);
    expect(encodeVector(new Array(1536).fill(0.5)).length).toBeLessThan(8300);
  });
});

describe('syncIndex', () => {
  test('first run indexes everything and saves the manifest and chunks', async () => {
    const dir = path.join(tmp(), 'idx');
    const e = embedder();
    const r = await sync(dir, DOCS(), e);
    expect(r.changes).toEqual({ added: ['guide.md', 'faq.md', 'empty.md'], updated: [], removed: [], unchanged: 0 });
    expect(r.entries.map((x) => x.id)).toEqual(['guide.md#1', 'guide.md#2', 'guide.md#3', 'faq.md#1', 'faq.md#2']);
    expect(e.texts).toHaveLength(5);
    expect(r).toMatchObject({ embedded: 5, reused: 0, rebuilt: null, problem: null, saved: true });
    const saved = readIndex(dir);
    expect(saved.manifest.settings).toEqual({ chunking: { strategy: 'paragraph', size: SIZE, overlap: 0 }, embeddings: 'test:model-a', contextual: null });
    expect(saved.manifest.documents['empty.md']).toMatchObject({ chunks: [] });
    expect(saved.entries[0].vector).toHaveLength(256);
    expect(summary(r)).toBe('3 added, 0 updated, 0 removed, 0 unchanged · embedded 5 chunks, reused 0 · 5 chunks');
  });

  test('nothing changed: no embedding, nothing written, the same store', async () => {
    const dir = path.join(tmp(), 'idx');
    await sync(dir, DOCS(), embedder());
    const before = fs.statSync(path.join(dir, 'chunks.json')).mtimeMs;
    const e = embedder();
    const r = await sync(dir, DOCS(), e);
    expect(r.changes).toEqual({ added: [], updated: [], removed: [], unchanged: 3 });
    expect(e.texts).toHaveLength(0);
    expect(r.saved).toBe(false);
    expect(fs.statSync(path.join(dir, 'chunks.json')).mtimeMs).toBe(before);
    expect((await r.store.query(keywordVector('refunds business days'), 1))[0].id).toBe('faq.md#1');
    expect(summary(r)).toMatch(/0 added, 0 updated, 0 removed, 3 unchanged · 5 chunks · nothing to save$/);
  });

  test('an edited document re-embeds only the chunks whose text changed', async () => {
    const dir = path.join(tmp(), 'idx');
    await sync(dir, DOCS(), embedder());
    const docs = DOCS();
    docs[0].content = docs[0].content.replace('Set the API key in your env file.', 'Set OPENAI_API_KEY in the env file.');
    const e = embedder();
    const r = await sync(dir, docs, e);
    expect(r.changes).toEqual({ added: [], updated: ['guide.md'], removed: [], unchanged: 2 });
    expect(e.texts).toEqual(['Set OPENAI_API_KEY in the env file.']);
    expect(r).toMatchObject({ embedded: 1, reused: 2 });
    expect(r.entries.find((x) => x.id === 'guide.md#2').content).toBe('Set OPENAI_API_KEY in the env file.');
  });

  test('deleted documents are removed, new ones added, and order follows the documents', async () => {
    const dir = path.join(tmp(), 'idx');
    await sync(dir, DOCS(), embedder());
    const docs = [{ id: 'new.md', content: 'Brand new page about webhooks.' }, DOCS()[0]];
    const r = await sync(dir, docs, embedder());
    expect(r.changes).toEqual({ added: ['new.md'], updated: [], removed: ['faq.md', 'empty.md'], unchanged: 1 });
    expect(r.entries.map((x) => x.id)).toEqual(['new.md#1', 'guide.md#1', 'guide.md#2', 'guide.md#3']);
    expect(Object.keys(readIndex(dir).manifest.documents)).toEqual(['new.md', 'guide.md']);
  });

  test('a settings change rebuilds and says why; vectors are reused only for the same model', async () => {
    const dir = path.join(tmp(), 'idx');
    await sync(dir, DOCS(), embedder());
    const sized = await sync(dir, DOCS(), embedder(), { chunking: { size: 500 } });
    expect(sized.rebuilt).toBe('chunk size 50 → 500');
    expect(sized.changes).toEqual({ added: [], updated: ['guide.md', 'faq.md', 'empty.md'], removed: [], unchanged: 0 });
    expect(summary(sized)).toMatch(/^rebuilt \(chunk size 50 → 500\)/);

    // Same chunking back, same model: identical chunk texts reuse their vectors
    await sync(dir, DOCS(), embedder());
    const back = embedder();
    const again = await sync(dir, DOCS(), back, { chunking: { size: 500 } });
    expect(again.reused + again.embedded).toBe(2);

    const other = embedder();
    const model = await sync(dir, DOCS(), other, { chunking: { size: 500 }, embeddings: 'test:model-b' });
    expect(model.rebuilt).toBe('embeddings test:model-a → test:model-b');
    // Another model's vectors can't be reused, even for the same text
    expect(model.reused).toBe(0);
    expect(other.texts).toHaveLength(2);
  });

  test('keyword-only (no embedder) saves chunks without vectors', async () => {
    const dir = path.join(tmp(), 'idx');
    const r = await syncIndex({ documents: DOCS(), dir, chunking: { size: SIZE } });
    expect(r.entries.every((x) => x.vector.length === 0)).toBe(true);
    expect((await r.store.searchText('refunds', 1))[0].id).toBe('faq.md#1');
    expect(readIndex(dir).manifest.settings.embeddings).toBeNull();
  });

  test('a damaged or half-written index is rebuilt, not trusted', async () => {
    const dir = path.join(tmp(), 'idx');
    await sync(dir, DOCS(), embedder());
    fs.writeFileSync(path.join(dir, 'chunks.json'), '{ broken');
    const damaged = await sync(dir, DOCS(), embedder());
    expect(damaged.problem).toMatch(/could not be read/);
    expect(damaged.embedded).toBe(5);
    expect(summary(damaged)).toMatch(/^rebuilt: it could not be read/);

    // Chunks from one save, manifest from another: an interrupted save
    const manifest = JSON.parse(fs.readFileSync(path.join(dir, 'manifest.json'), 'utf8'));
    fs.writeFileSync(path.join(dir, 'manifest.json'), JSON.stringify({ ...manifest, generation: 'other' }));
    const mixed = await sync(dir, DOCS(), embedder());
    expect(mixed.problem).toMatch(/from different saves/);
    expect(readIndex(dir).problem).toBeNull();
  });

  test('repeated document ids keep their ~2 suffix from run to run', async () => {
    const dir = path.join(tmp(), 'idx');
    const docs = [{ id: 'README.md', content: 'First readme.' }, { id: 'README.md', content: 'Second readme.' }];
    await sync(dir, docs, embedder());
    const r = await sync(dir, docs, embedder());
    expect(r.changes.unchanged).toBe(2);
    expect(r.entries.map((x) => x.id)).toEqual(['README.md#1', 'README.md~2#1']);
  });

  test('checks its options', async () => {
    await expect(syncIndex({ documents: [] })).rejects.toThrow(/`dir` is required/);
    await expect(syncIndex({ documents: [], dir: tmp(), contextualize: async () => ({}) })).rejects.toThrow(/name the `contextual` model/);
    await expect(syncIndex({ documents: [], dir: tmp(), chunking: { strategy: 'words' } })).rejects.toThrow(/Unknown chunking strategy/);
  });
});

describe('rf.index({ dir }) and rf.loadIndex', () => {
  const respond = (p) => (p.includes('<passage>') ? 'From the Acme guide.' : 'An answer [1].');

  test('saves, updates incrementally, and serves queries', async () => {
    const dir = path.join(tmp(), 'idx');
    const llm = createKeywordProvider(respond);
    const rf = createRagforge({ llm });
    const first = await rf.index(DOCS(), { dir, chunkSize: SIZE });
    expect(first).toMatchObject({ count: 5, embedded: 5, saved: true });
    expect(first.stats.embeddingCalls).toBe(5);
    expect((await rf.ragPipeline('refunds business days', { techniques: [], topK: 1 })).sources[0].id).toBe('faq.md#1');

    const second = await rf.index(DOCS(), { dir, chunkSize: SIZE });
    expect(second.stats.embeddingCalls).toBe(0);
    expect(readIndex(dir).manifest.settings.embeddings).toBe(embeddingsId(llm));
  });

  test('contextual: context lines are written only for changed documents', async () => {
    const dir = path.join(tmp(), 'idx');
    const llm = createKeywordProvider(respond);
    const rf = createRagforge({ llm });
    const contextCalls = () => llm.calls.chat.filter((c) => c.prompt.includes('<passage>')).length;
    const r = await rf.index(DOCS(), { dir, chunkSize: SIZE, contextual: true });
    expect(contextCalls()).toBe(5);
    expect(r.entries[0]).toMatchObject({ context: 'From the Acme guide.', indexText: 'From the Acme guide.\n\nInstall the package with npm first.' });
    expect(readIndex(dir).manifest.settings.contextual).toBe('gpt-4o-mini');

    const docs = DOCS();
    docs[1].content += '\n\nSupport answers within a day.';
    const updated = await rf.index(docs, { dir, chunkSize: SIZE, contextual: true });
    // Only faq.md (3 chunks now) gets new lines; the vectors of its 2 old chunks are reused
    expect(contextCalls()).toBe(8);
    expect(updated).toMatchObject({ embedded: 1, reused: 2 });

    const off = await rf.index(docs, { dir, chunkSize: SIZE });
    expect(off.rebuilt).toBe('context lines gpt-4o-mini → off');
  });

  test('a tuned config sets the chunking of a saved index', async () => {
    const dir = path.join(tmp(), 'idx');
    const llm = createKeywordProvider(respond);
    const config = { version: 1, chunking: { strategy: 'sentence', size: 60, overlap: 0 }, technique: 'baseline', topK: 1 };
    const rf = createRagforge({ llm, embeddings: llm, config });
    await rf.index(DOCS(), { dir });
    expect(readIndex(dir).manifest.settings.chunking).toEqual({ strategy: 'sentence', size: 60, overlap: 0 });
  });

  test('loadIndex serves a saved index without the documents, and refuses another embedding model', async () => {
    const dir = path.join(tmp(), 'idx');
    const llm = createKeywordProvider(respond);
    await createRagforge({ llm }).index(DOCS(), { dir, chunkSize: SIZE });

    const rf = createRagforge({ llm });
    const loaded = rf.loadIndex(dir);
    expect(loaded.count).toBe(5);
    expect(loaded.manifest.documents['guide.md'].chunks).toHaveLength(3);
    expect((await rf.ragPipeline('refunds business days', { techniques: [], topK: 1 })).sources[0].id).toBe('faq.md#1');

    const other = createRagforge({ llm: { ...createKeywordProvider(respond), embeddingModel: 'other-model' } });
    expect(() => other.loadIndex(dir)).toThrow(/built with embeddings keyword:text-embedding-3-small, but this instance uses keyword:other-model/);
    expect(() => rf.loadIndex(path.join(tmp(), 'none'))).toThrow(/No saved index in .*Build one with: npx ragforge index/);
  });
});

describe('watchSources', () => {
  test('a change calls back once per burst, with the changed path; hidden folders are ignored', async () => {
    const dir = tmp();
    fs.writeFileSync(path.join(dir, 'a.md'), 'one');
    fs.mkdirSync(path.join(dir, '.ragforge'));
    const calls = [];
    const w = watchSources([dir], { debounceMs: 150, onChange: (changed) => calls.push(changed) });
    try {
      expect(w.watching).toEqual([dir]);
      fs.writeFileSync(path.join(dir, '.ragforge', 'x.json'), '{}');
      await new Promise((r) => setTimeout(r, 400));
      expect(calls).toHaveLength(0);
      fs.writeFileSync(path.join(dir, 'a.md'), 'two');
      fs.writeFileSync(path.join(dir, 'a.md'), 'three');
      await until(() => calls.length === 1);
      expect(calls[0].some((p) => p.endsWith('a.md'))).toBe(true);
      await new Promise((r) => setTimeout(r, 300));
      expect(calls).toHaveLength(1);
    } finally {
      w.close();
    }
  });

  test('a single file is watched through its folder; URLs are skipped; close stops it', async () => {
    const dir = tmp();
    const file = path.join(dir, 'one.md');
    fs.writeFileSync(file, 'x');
    const calls = [];
    const w = watchSources([file, 'https://example.com/faq'], { debounceMs: 100, onChange: () => calls.push(1) });
    expect(w.skipped).toEqual(['https://example.com/faq']);
    fs.writeFileSync(path.join(dir, 'other.md'), 'not this one');
    await new Promise((r) => setTimeout(r, 300));
    expect(calls).toHaveLength(0);
    fs.writeFileSync(file, 'y');
    await until(() => calls.length === 1);
    w.close();
    fs.writeFileSync(file, 'z');
    await new Promise((r) => setTimeout(r, 300));
    expect(calls).toHaveLength(1);
  });

  test('ignored() skips hidden paths and node_modules only', () => {
    expect(ignored('.git/HEAD')).toBe(true);
    expect(ignored(path.join('docs', 'node_modules', 'x.md'))).toBe(true);
    expect(ignored(path.join('docs', 'guide.md'))).toBe(false);
  });
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

function project() {
  const dir = tmp();
  fs.mkdirSync(path.join(dir, 'docs'));
  DOCS().forEach((d) => fs.writeFileSync(path.join(dir, 'docs', d.id), d.content));
  const llm = createKeywordProvider(() => 'Five business days [1].');
  const factory = (opts) => createRagforge({ ...opts, llm, embeddings: llm });
  return { dir, factory, llm };
}

describe('CLI', () => {
  test('index builds, then only reports what changed', async () => {
    const { dir, factory, llm } = project();
    const a = io();
    expect(await main(['index', '--docs', 'docs', '--chunk-size', String(SIZE)], { ...a, cwd: dir, createRagforge: factory })).toBe(0);
    expect(a.out).toMatch(/^2 added, 0 updated, 0 removed, 0 unchanged · embedded 5 chunks, reused 0 · 5 chunks · (\$0\.\d+|<\$0\.0001) · [\d.]+s/);
    expect(a.out).toMatch(/Index saved to \.ragforge\/index\. Use it with: npx ragforge chat --docs docs --index \.ragforge\/index/);
    // In the project folder given as cwd, not wherever the process runs
    expect(fs.existsSync(path.join(dir, '.ragforge', 'index', 'manifest.json'))).toBe(true);
    expect(fs.existsSync(path.join(process.cwd(), '.ragforge', 'index'))).toBe(false);

    fs.writeFileSync(path.join(dir, 'docs', 'faq.md'), 'Refunds take five business days.\n\nInvoices arrive on day two.');
    const b = io();
    expect(await main(['index', '--docs', 'docs', '--chunk-size', String(SIZE)], { ...b, cwd: dir, createRagforge: factory })).toBe(0);
    expect(b.out).toMatch(/^0 added, 1 updated, 0 removed, 1 unchanged · embedded 1 chunk, reused 1 · 5 chunks/);
    expect(llm.calls.embed).toHaveLength(6);
  });

  test('index --watch updates on a change and stops when told to', async () => {
    const { dir, factory } = project();
    const a = io();
    const controller = new AbortController();
    const running = main(['index', '--docs', 'docs', '--chunk-size', String(SIZE), '--watch'], { ...a, cwd: dir, createRagforge: factory, signal: controller.signal });
    try {
      await until(() => a.err.includes('Watching 1 path(s) for changes'));
      expect(a.out).toMatch(/^\[\d\d:\d\d:\d\d\] 2 added/);
      fs.writeFileSync(path.join(dir, 'docs', 'new.md'), 'Webhooks retry three times.');
      await until(() => /1 added, 0 updated, 0 removed, 2 unchanged/.test(a.out));
    } finally {
      // Always stop watching, so a failure can't leave the test run hanging
      controller.abort();
    }
    expect(await running).toBe(0);
  });

  test('chat --index starts from the saved index', async () => {
    const { dir, factory, llm } = project();
    await main(['index', '--docs', 'docs', '--chunk-size', String(SIZE)], { ...io(), cwd: dir, createRagforge: factory });
    const before = llm.calls.embed.length;
    const stdin = new PassThrough();
    stdin.end('How long do refunds take?\nexit\n');
    const a = io();
    expect(await main(['chat', '--docs', 'docs', '--chunk-size', String(SIZE), '--index', '.ragforge/index'], { ...a, stdin, cwd: dir, createRagforge: factory })).toBe(0);
    expect(a.err).toMatch(/Index \.ragforge\/index: 0 added, 0 updated, 0 removed, 2 unchanged · 5 chunks · nothing to save/);
    expect(a.out).toMatch(/Five business days \[1\]\./);
    // Only query texts were embedded: no chunk of the saved index was embedded again
    const chunkTexts = new Set(DOCS().flatMap((d) => d.content.split('\n\n')).filter(Boolean));
    const embeddedNow = llm.calls.embed.slice(before);
    expect(embeddedNow.length).toBeGreaterThan(0);
    expect(embeddedNow.filter((t) => chunkTexts.has(t))).toEqual([]);
  });
});

describe('MCP --index --watch', () => {
  test('serves the saved index and picks up a changed file without restarting', async () => {
    const { dir } = project();
    const docsDir = path.join(dir, 'docs');
    const { loadDocuments } = require('../../index');
    const load = () => loadDocuments(docsDir);
    const stdin = new PassThrough();
    const stdout = new PassThrough();
    const stderr = new PassThrough();
    let out = '';
    let err = '';
    stdout.on('data', (d) => (out += d));
    stderr.on('data', (d) => (err += d));
    const server = startMcpServer({
      documents: await load(),
      chunkSize: SIZE,
      indexDir: path.join(dir, 'idx'),
      watch: { sources: [docsDir], load },
      stdin,
      stdout,
      stderr,
    });
    const ask = (id, query) => stdin.write(`${JSON.stringify({ jsonrpc: '2.0', id, method: 'tools/call', params: { name: 'search_docs', arguments: { query, top_k: 1 } } })}\n`);
    const reply = (id) => out.split('\n').filter(Boolean).map((l) => JSON.parse(l)).find((m) => m.id === id);

    try {
      await until(() => /indexed 5 passages from 2 document\(s\) \(keyword search only; .*idx: 2 added/.test(err));
      expect(err).toMatch(/watching 1 path\(s\) for changes/);
      ask(1, 'webhooks retry');
      await until(() => reply(1));
      expect(reply(1).result.content[0].text).not.toMatch(/Webhooks/);

      fs.writeFileSync(path.join(docsDir, 'hooks.md'), 'Webhooks retry three times with backoff.');
      await until(() => /indexed 6 passages from 3 document\(s\) .*1 added, 0 updated, 0 removed, 2 unchanged/.test(err));
      ask(2, 'webhooks retry');
      await until(() => reply(2));
      expect(reply(2).result.content[0].text).toMatch(/docs\/hooks\.md#1\nWebhooks retry three times/);
    } finally {
      // Closing stdin stops the server and its watcher, even when the test fails
      stdin.end();
      await server;
    }
  });
});
