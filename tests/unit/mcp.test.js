// Unit tests for the MCP server (no network): JSON-RPC over in-memory streams,
// plus one end-to-end run of the real `ragforge mcp` process over stdio

const fs = require('fs');
const os = require('os');
const path = require('path');
const { PassThrough } = require('stream');
const { spawnSync } = require('child_process');
const { startMcpServer, topKArg, MAX_TOP_K } = require('../../src/mcp/server');
const { main } = require('../../src/cli');
const { createKeywordProvider } = require('./helpers');

const DOCS = [
  { id: 'config.md', content: 'Set maxTokens to limit the length of the reply. The ERR_PAYMENT_42 code means the card was declined.\n\nCats purr and groom their fur.' },
  { id: 'guide/setup.md', content: 'Install the package with npm. Then run the migration script before starting the server.' },
  // Three paragraphs of ~500 characters each: one passage per paragraph, so neighbours exist
  { id: 'long.md', content: ['Quotas reset monthly. '.repeat(24), 'Billing starts on the first day. '.repeat(16), 'Teams share one pool of tokens. '.repeat(16)].join('\n\n') },
];
const PASSAGES = 5;

// Runs the server against scripted input lines and returns every response by id
async function session(lines, options = {}) {
  const stdin = new PassThrough();
  const stdout = new PassThrough();
  const stderr = new PassThrough();
  let out = '';
  let err = '';
  stdout.on('data', (d) => (out += d));
  stderr.on('data', (d) => (err += d));

  const done = startMcpServer({ documents: DOCS, stdin, stdout, stderr, ...options });
  for (const line of lines) stdin.write(typeof line === 'string' ? `${line}\n` : `${JSON.stringify(line)}\n`);
  stdin.end();
  await done;

  const messages = out.split('\n').filter(Boolean).map((l) => JSON.parse(l));
  return { byId: Object.fromEntries(messages.filter((m) => m.id !== undefined).map((m) => [m.id, m])), messages, err };
}

const call = (id, name, args) => ({ jsonrpc: '2.0', id, method: 'tools/call', params: { name, arguments: args } });
const text = (res) => res.result.content[0].text;

describe('MCP server', () => {
  test('initialize negotiates a supported protocol version and advertises tools', async () => {
    const { byId } = await session([{ jsonrpc: '2.0', id: 1, method: 'initialize', params: { protocolVersion: '2024-11-05' } }]);
    expect(byId[1].result.protocolVersion).toBe('2024-11-05');
    expect(byId[1].result.capabilities.tools).toBeDefined();
    expect(byId[1].result.serverInfo.name).toBe('ragforge');

    const fallback = await session([{ jsonrpc: '2.0', id: 1, method: 'initialize', params: { protocolVersion: '1999-01-01' } }]);
    expect(fallback.byId[1].result.protocolVersion).toBe('2025-06-18');
  });

  test('tools/list exposes search_docs, get_chunk and ask with input schemas', async () => {
    const { byId } = await session([{ jsonrpc: '2.0', id: 2, method: 'tools/list' }]);
    const names = byId[2].result.tools.map((t) => t.name);
    expect(names).toEqual(['search_docs', 'get_chunk', 'ask']);
    for (const tool of byId[2].result.tools) {
      expect(tool.inputSchema.type).toBe('object');
      expect(tool.description.length).toBeGreaterThan(20);
    }
  });

  test('search_docs finds exact terms with no API key or embeddings', async () => {
    const { byId, err } = await session([call(3, 'search_docs', { query: 'ERR_PAYMENT_42' })]);
    expect(text(byId[3])).toMatch(/^\[1\] config\.md#1/);
    expect(text(byId[3])).toMatch(/card was declined/);
    expect(err).toMatch(new RegExp(`indexed ${PASSAGES} passages from 3 document\\(s\\) \\(keyword search only\\)`));
  });

  test('search_docs reports when nothing matches and respects top_k', async () => {
    const { byId } = await session([call(4, 'search_docs', { query: 'kubernetes' }), call(5, 'search_docs', { query: 'npm migration server', top_k: 1 })]);
    expect(text(byId[4])).toMatch(/No passages match/);
    expect(text(byId[5]).match(/^\[\d\]/gm)).toHaveLength(1);
  });

  test('search_docs rejects a bad top_k or empty query as a tool error, not a protocol error', async () => {
    const { byId } = await session([call(6, 'search_docs', { query: 'npm', top_k: 0 }), call(7, 'search_docs', { query: '  ' })]);
    expect(byId[6].result.isError).toBe(true);
    expect(text(byId[6])).toMatch(/top_k must be a whole number from 1 to 20/);
    expect(byId[7].result.isError).toBe(true);
  });

  test('get_chunk returns a passage with its neighbours from the same document only', async () => {
    const { byId } = await session([call(8, 'get_chunk', { id: 'long.md#2' }), call(9, 'get_chunk', { id: 'long.md#1' }), call(10, 'get_chunk', { id: 'guide/setup.md#1' })]);
    expect(text(byId[8])).toMatch(/^long\.md#2/);
    expect(text(byId[8])).toMatch(/\[long\.md#1\]/);
    expect(text(byId[8])).toMatch(/\[long\.md#3\]/);
    // First passage of a document has no previous one, and a one-passage document has none at all
    expect(text(byId[9])).toMatch(/\[long\.md#2\]/);
    expect(text(byId[9])).not.toMatch(/\[long\.md#0\]/);
    expect(text(byId[10])).not.toMatch(/Nearby passages/);
  });

  test('get_chunk on an unknown id is a tool error that points to search_docs', async () => {
    const { byId } = await session([call(10, 'get_chunk', { id: 'nope.md#9' })]);
    expect(byId[10].result.isError).toBe(true);
    expect(text(byId[10])).toMatch(/Use search_docs/);
  });

  test('ask without a language model returns passages and says why', async () => {
    const { byId } = await session([call(11, 'ask', { question: 'what does maxTokens do' })]);
    expect(text(byId[11])).toMatch(/No language model is configured/);
    expect(text(byId[11])).toMatch(/maxTokens/);
  });

  test('ask with a language model returns a cited answer and the route', async () => {
    const llm = createKeywordProvider((prompt) => (prompt.includes('Context passages') ? 'maxTokens caps the reply length [1].' : 'Use the setup guide.'));
    const { byId } = await session([call(12, 'ask', { question: 'what does maxTokens do' })], { llm });
    expect(text(byId[12])).toMatch(/maxTokens caps the reply length \[1\]\./);
    expect(text(byId[12])).toMatch(/Sources:\n\n\[1\] config\.md#1/);
    expect(text(byId[12])).toMatch(/Route: /);
  });

  test('with an embedder, search fuses vector and keyword results', async () => {
    const embedder = createKeywordProvider(() => '');
    const { byId, err } = await session([call(13, 'search_docs', { query: 'purr fur' })], { embedder });
    expect(text(byId[13])).toMatch(/config\.md#1/);
    expect(embedder.calls.embed.length).toBeGreaterThan(0);
    expect(err).not.toMatch(/keyword search only/);
  });

  test('a failed embedding during indexing is reported by every tool call', async () => {
    const embedder = { name: 'broken', embeddingModel: 'x', embed: async () => { throw new Error('connection refused'); } };
    const { byId, err } = await session([call(14, 'search_docs', { query: 'npm' })], { embedder });
    expect(byId[14].result.isError).toBe(true);
    expect(text(byId[14])).toMatch(/connection refused/);
    expect(err).toMatch(/indexing failed: connection refused/);
  });

  test('unknown tools and methods get JSON-RPC errors; notifications get no reply', async () => {
    const { byId, messages } = await session([
      call(15, 'delete_everything', {}),
      { jsonrpc: '2.0', id: 16, method: 'resources/list' },
      { jsonrpc: '2.0', method: 'notifications/initialized' },
      { jsonrpc: '2.0', id: 17, method: 'ping' },
    ]);
    expect(byId[15].error.code).toBe(-32602);
    expect(byId[16].error.code).toBe(-32601);
    expect(byId[17].result).toEqual({});
    expect(messages).toHaveLength(3);
  });

  test('malformed JSON gets a parse error with a null id and the server keeps going', async () => {
    const { messages, byId } = await session(['{not json', { jsonrpc: '2.0', id: 18, method: 'ping' }]);
    expect(messages[0]).toMatchObject({ id: null, error: { code: -32700 } });
    expect(byId[18].result).toEqual({});
  });

  test('topKArg validates the range and defaults', () => {
    expect(topKArg(undefined)).toBe(5);
    expect(topKArg(MAX_TOP_K)).toBe(MAX_TOP_K);
    expect(() => topKArg(MAX_TOP_K + 1)).toThrow();
    expect(() => topKArg(1.5)).toThrow();
  });

  test('stdout carries only JSON-RPC lines', async () => {
    const stdin = new PassThrough();
    const stdout = new PassThrough();
    let out = '';
    stdout.on('data', (d) => (out += d));
    const done = startMcpServer({ documents: DOCS, stdin, stdout, stderr: new PassThrough() });
    stdin.end(`${JSON.stringify(call(19, 'search_docs', { query: 'npm' }))}\n`);
    await done;
    for (const line of out.split('\n').filter(Boolean)) expect(() => JSON.parse(line)).not.toThrow();
  });
});

describe('ragforge mcp command', () => {
  let dir;
  beforeEach(() => {
    dir = fs.mkdtempSync(path.join(os.tmpdir(), 'ragforge-mcp-'));
    fs.mkdirSync(path.join(dir, 'docs'));
    fs.writeFileSync(path.join(dir, 'docs', 'a.md'), 'Hybrid search combines BM25 with vectors.');
  });
  afterEach(() => fs.rmSync(dir, { recursive: true, force: true }));

  test('requires --docs', async () => {
    let err = '';
    const code = await main(['mcp'], { stdout: { write() {} }, stderr: { write: (s) => (err += s) }, cwd: dir, stdin: new PassThrough() });
    expect(code).toBe(1);
    expect(err).toMatch(/--docs is required/);
  });

  test('fails clearly when the folder has no readable documents', async () => {
    fs.mkdirSync(path.join(dir, 'empty'));
    let err = '';
    const code = await main(['mcp', '--docs', 'empty'], { stdout: { write() {} }, stderr: { write: (s) => (err += s) }, cwd: dir, stdin: new PassThrough() });
    expect(code).toBe(1);
    expect(err).toMatch(/No readable documents/);
  });

  test('serves the folder over the given stdin and stdout and does not need OPENAI_API_KEY', async () => {
    const saved = process.env.OPENAI_API_KEY;
    delete process.env.OPENAI_API_KEY;
    try {
      const stdin = new PassThrough();
      let out = '';
      const stdout = { write: (s) => (out += s) };
      const pending = main(['mcp', '--docs', 'docs'], { stdout, stderr: { write() {} }, cwd: dir, stdin });
      stdin.end(`${JSON.stringify(call(1, 'search_docs', { query: 'bm25' }))}\n`);
      expect(await pending).toBe(0);
      expect(out).toMatch(/Hybrid search combines BM25/);
    } finally {
      if (saved !== undefined) process.env.OPENAI_API_KEY = saved;
    }
  });
});

describe('ragforge mcp as a process', () => {
  test('a client can initialize, list tools and search over stdio', () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'ragforge-e2e-'));
    try {
      fs.mkdirSync(path.join(dir, 'docs'));
      fs.writeFileSync(path.join(dir, 'docs', 'errors.md'), 'Error ERR_PAYMENT_42 means the card was declined by the bank.');
      const input = [
        { jsonrpc: '2.0', id: 1, method: 'initialize', params: { protocolVersion: '2025-06-18', capabilities: {}, clientInfo: { name: 'test', version: '1' } } },
        { jsonrpc: '2.0', method: 'notifications/initialized' },
        { jsonrpc: '2.0', id: 2, method: 'tools/list' },
        call(3, 'search_docs', { query: 'ERR_PAYMENT_42' }),
      ].map((m) => JSON.stringify(m)).join('\n');

      const bin = path.join(__dirname, '..', '..', 'bin', 'ragforge.js');
      const env = { ...process.env };
      delete env.OPENAI_API_KEY;
      const run = spawnSync(process.execPath, [bin, 'mcp', '--docs', 'docs'], { cwd: dir, input, env, encoding: 'utf8' });

      expect(run.status).toBe(0);
      const replies = Object.fromEntries(run.stdout.trim().split('\n').map((l) => JSON.parse(l)).map((m) => [m.id, m]));
      expect(replies[1].result.serverInfo.name).toBe('ragforge');
      expect(replies[2].result.tools.map((t) => t.name)).toEqual(['search_docs', 'get_chunk', 'ask']);
      expect(replies[3].result.content[0].text).toMatch(/errors\.md#1/);
      expect(run.stderr).toMatch(/\[ragforge mcp\] indexed 1 passages/);
    } finally {
      fs.rmSync(dir, { recursive: true, force: true });
    }
  });
});
