// Unit tests for document loaders: HTML, PDF, DOCX, folders and URLs (no network)

const fs = require('fs');
const os = require('os');
const path = require('path');
const { loadDocuments, htmlToText, createRagforge } = require('../../index');
const { main } = require('../../src/cli');
const { createKeywordProvider } = require('./helpers');

const FIXTURES = path.join(__dirname, '..', 'fixtures');
// unpdf (pdf.js) supports Node 22+; older Node versions skip the PDF tests
const pdfTest = Number(process.versions.node.split('.')[0]) >= 22 ? test : test.skip;

function fakeFetch(routes) {
  return async (url) => {
    const route = routes[url];
    if (!route) return { ok: false, status: 404, headers: new Map() };
    const body = route.body;
    return {
      ok: true,
      status: 200,
      headers: new Map([['content-type', route.type]]),
      text: async () => String(body),
      arrayBuffer: async () => (Buffer.isBuffer(body) ? body.buffer.slice(body.byteOffset, body.byteOffset + body.length) : Buffer.from(body)),
    };
  };
}

describe('htmlToText', () => {
  test('keeps the main content as headings, paragraphs and list items', () => {
    const html = `<!doctype html><html><head><title>Ignored</title><style>p{}</style></head><body>
      <nav><a href="/">Home</a> <a href="/docs">Docs</a></nav>
      <main><h1>Refunds</h1><p>Annual plans are refunded within <b>5&nbsp;days</b> &amp; monthly plans aren&#39;t.</p>
      <ul><li>Email support</li><li>Include your order&#x20;ID</li></ul><script>track()</script></main>
      <footer>© 2026</footer></body></html>`;

    expect(htmlToText(html)).toBe("# Refunds\n\nAnnual plans are refunded within 5 days & monthly plans aren't.\n\n- Email support\n- Include your order ID");
  });

  test('without <main>, drops page chrome and uses the title as a heading', () => {
    const html = '<title>FAQ</title><header>Logo</header><div>Question one?</div><aside>Ads</aside><div>Answer.</div>';
    expect(htmlToText(html)).toBe('# FAQ\n\nQuestion one?\n\nAnswer.');
  });
});

describe('loadDocuments', () => {
  let dir;
  beforeEach(() => {
    dir = fs.mkdtempSync(path.join(os.tmpdir(), 'ragforge-load-'));
    fs.mkdirSync(path.join(dir, 'docs', 'guides'), { recursive: true });
    fs.writeFileSync(path.join(dir, 'docs', 'intro.md'), '# Intro\n\nHello.');
    fs.writeFileSync(path.join(dir, 'docs', 'guides', 'faq.html'), '<main><h2>FAQ</h2><p>Yes.</p></main>');
    fs.copyFileSync(path.join(FIXTURES, 'sample.pdf'), path.join(dir, 'docs', 'billing.pdf'));
    fs.copyFileSync(path.join(FIXTURES, 'sample.docx'), path.join(dir, 'docs', 'guides', 'handbook.docx'));
    fs.writeFileSync(path.join(dir, 'docs', 'logo.png'), 'not text');
    fs.writeFileSync(path.join(dir, 'docs', 'empty.md'), '   ');
  });
  afterEach(() => fs.rmSync(dir, { recursive: true, force: true }));

  pdfTest('reads Markdown, HTML, PDF and DOCX from a folder, skipping other and empty files', async () => {
    const docs = await loadDocuments('docs', { cwd: dir });
    const byId = Object.fromEntries(docs.map((d) => [d.id, d]));

    expect(Object.keys(byId).sort()).toEqual(['docs/billing.pdf', 'docs/guides/faq.html', 'docs/guides/handbook.docx', 'docs/intro.md']);
    expect(byId['docs/billing.pdf'].content).toBe('Refunds for annual plans are issued within 5 business days.\n\nError E42 means the disk is full.');
    expect(byId['docs/guides/handbook.docx'].content).toBe('Onboarding handbook\n\nNew hires get a laptop on their first day.');
    expect(byId['docs/guides/faq.html'].content).toBe('## FAQ\n\nYes.');
    expect(byId['docs/billing.pdf'].metadata).toMatchObject({ type: '.pdf' });
  });

  pdfTest('loads URLs by content type, including PDFs sent as octet-stream', async () => {
    const fetch = fakeFetch({
      'https://example.com/faq': { type: 'text/html; charset=utf-8', body: '<article><h1>FAQ</h1><p>Answers.</p></article>' },
      'https://example.com/files/terms.pdf': { type: 'application/octet-stream', body: fs.readFileSync(path.join(FIXTURES, 'sample.pdf')) },
      'https://example.com/notes.txt': { type: 'text/plain', body: 'plain <b>text</b>' },
    });

    const docs = await loadDocuments(['https://example.com/faq', 'https://example.com/files/terms.pdf', 'https://example.com/notes.txt'], { fetch });

    expect(docs.map((d) => [d.id, d.content.split('\n')[0]])).toEqual([
      ['https://example.com/faq', '# FAQ'],
      ['https://example.com/files/terms.pdf', 'Refunds for annual plans are issued within 5 business days.'],
      ['https://example.com/notes.txt', 'plain <b>text</b>'],
    ]);
    await expect(loadDocuments('https://example.com/missing', { fetch })).rejects.toThrow(/Could not fetch .* \(404\)/);
  });

  test('a missing optional package gives an install hint', async () => {
    let load;
    jest.isolateModules(() => {
      jest.doMock('mammoth', () => {
        const err = new Error("Cannot find module 'mammoth' from 'src/loaders/index.js'");
        err.code = 'MODULE_NOT_FOUND';
        throw err;
      });
      load = require('../../src/loaders').loadDocuments;
    });

    await expect(load('docs/guides/handbook.docx', { cwd: dir })).rejects.toThrow('Reading DOCX files needs the "mammoth" package: npm install mammoth');
    jest.dontMock('mammoth');
  });

  pdfTest('the eval CLI indexes PDFs and DOCX files', async () => {
    let text = '';
    const stdout = { write: (s) => (text += s) };
    const respond = (p) => (p.includes('Passage:\n') ? `${p.split('Passage:\n')[1].split('.')[0]}?` : 'ok');

    const code = await main(['eval', '--docs', 'docs', '--questions', '4', '--techniques', 'baseline', '--json', 'r.json'], {
      stdout,
      stderr: { write() {} },
      cwd: dir,
      createRagforge: () => createRagforge({ llm: createKeywordProvider(respond) }),
    });

    expect(code).toBe(0);
    const sources = JSON.parse(fs.readFileSync(path.join(dir, 'r.json'), 'utf8')).questions.map((q) => q.expectedId.split('#')[0]);
    expect(sources).toEqual(expect.arrayContaining(['docs/billing.pdf', 'docs/guides/handbook.docx']));
  });
});
