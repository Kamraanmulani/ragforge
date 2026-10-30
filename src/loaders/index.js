// Document loaders: text, Markdown, HTML, PDF, DOCX files and URLs -> { id, content }
// PDF and DOCX use optional peer dependencies (unpdf, mammoth), loaded only when needed.
const fs = require("fs");
const path = require("path");
const { mapLimit } = require("../core/limit");

const TEXT_EXTENSIONS = new Set([".txt", ".md", ".markdown", ".mdx", ".rst"]);
const HTML_EXTENSIONS = new Set([".html", ".htm"]);
const SUPPORTED_EXTENSIONS = new Set([...TEXT_EXTENSIONS, ...HTML_EXTENSIONS, ".pdf", ".docx"]);

/**
 * optionalRequire
 * Loads a peer dependency, with an install hint when it's missing.
 * ESM-only versions fall back to import().
 */
async function optionalRequire(name, purpose) {
  try {
    return require(name);
  } catch (err) {
    if (err.code === "ERR_REQUIRE_ESM") return import(name);
    if (err.code === "MODULE_NOT_FOUND" && String(err.message).includes(`'${name}'`)) {
      throw new Error(`[ragforge] Reading ${purpose} needs the "${name}" package: npm install ${name}`);
    }
    throw err;
  }
}

const ENTITIES = { amp: "&", lt: "<", gt: ">", quot: '"', apos: "'", nbsp: " ", mdash: "—", ndash: "–", hellip: "…", copy: "©", reg: "®", trade: "™" };

function decodeEntities(text) {
  return text.replace(/&(#x[\da-f]+|#\d+|[a-z]+);/gi, (match, code) => {
    if (code[0] === "#") {
      const n = code[1].toLowerCase() === "x" ? parseInt(code.slice(2), 16) : parseInt(code.slice(1), 10);
      return Number.isFinite(n) && n > 0 && n <= 0x10ffff ? String.fromCodePoint(n) : match;
    }
    return ENTITIES[code.toLowerCase()] ?? match;
  });
}

/**
 * htmlToText
 * Readable text from an HTML page: keeps <main>/<article> when present, drops
 * scripts, styles and page chrome (nav, header, footer, aside), and keeps
 * headings, paragraphs and list items on their own lines so chunking can use them.
 */
function htmlToText(html) {
  let s = String(html).replace(/<!--[\s\S]*?-->/g, "");
  const title = (s.match(/<title[^>]*>([\s\S]*?)<\/title>/i)?.[1] ?? "").trim();
  s = s.replace(/<(script|style|noscript|template|svg|head|iframe|title)\b[\s\S]*?<\/\1>/gi, "");

  const main = s.match(/<main\b[^>]*>([\s\S]*?)<\/main>/i) ?? s.match(/<article\b[^>]*>([\s\S]*?)<\/article>/i);
  if (main) s = main[1];
  else s = s.replace(/<(nav|header|footer|aside|form)\b[\s\S]*?<\/\1>/gi, "");

  s = s
    .replace(/<h([1-6])\b[^>]*>([\s\S]*?)<\/h\1>/gi, (_, level, text) => `\n\n${"#".repeat(Number(level))} ${text}\n\n`)
    .replace(/<li\b[^>]*>/gi, "\n- ")
    .replace(/<br\s*\/?>/gi, "\n")
    .replace(/<\/?(p|div|section|article|main|ul|ol|table|tr|pre|blockquote|figure|dl|dt|dd)\b[^>]*>/gi, "\n\n")
    .replace(/<\/?(td|th)\b[^>]*>/gi, " ")
    .replace(/<[^>]+>/g, "");

  const text = decodeEntities(s)
    .split("\n")
    .map((line) => line.replace(/[ \t\f\v ]+/g, " ").trim())
    .join("\n")
    .replace(/\n{3,}/g, "\n\n")
    .trim();

  // Pages without a top heading get their <title>, so chunks keep their context
  if (title && !/^#\s/.test(text)) return `# ${decodeEntities(title)}\n\n${text}`;
  return text;
}

async function pdfToText(data) {
  const { extractText, getDocumentProxy } = await optionalRequire("unpdf", "PDF files");
  const pdf = await getDocumentProxy(new Uint8Array(data));
  const { text } = await extractText(pdf, { mergePages: false });
  return (Array.isArray(text) ? text : [text]).map((page) => page.trim()).filter(Boolean).join("\n\n");
}

async function docxToText(data) {
  const mammoth = await optionalRequire("mammoth", "DOCX files");
  const { value } = await mammoth.extractRawText({ buffer: Buffer.from(data) });
  return value.trim();
}

/**
 * parseDocument
 * @param {Buffer|string} data - File contents
 * @param {string} type - Extension (".pdf") or content type ("application/pdf")
 */
async function parseDocument(data, type) {
  const t = String(type).toLowerCase();
  if (t === ".pdf" || t.includes("application/pdf")) return pdfToText(data);
  if (t === ".docx" || t.includes("wordprocessingml")) return docxToText(data);
  const text = Buffer.isBuffer(data) ? data.toString("utf8") : String(data);
  if (HTML_EXTENSIONS.has(t) || t.includes("text/html") || t.includes("xhtml")) return htmlToText(text);
  return text;
}

function collectFiles(target) {
  const stat = fs.statSync(target);
  if (stat.isFile()) return [target];
  return fs
    .readdirSync(target, { withFileTypes: true })
    .filter((e) => !e.name.startsWith(".") && e.name !== "node_modules")
    .flatMap((e) => {
      const full = path.join(target, e.name);
      if (e.isDirectory()) return collectFiles(full);
      return SUPPORTED_EXTENSIONS.has(path.extname(e.name).toLowerCase()) ? [full] : [];
    });
}

const isURL = (source) => /^https?:\/\//i.test(source);

async function loadURL(url, fetchImpl) {
  const res = await fetchImpl(url, { headers: { "User-Agent": "ragforge (+https://github.com/Kamraanmulani/ragforge)" } });
  if (!res.ok) throw new Error(`[ragforge] Could not fetch ${url} (${res.status})`);
  const contentType = res.headers.get("content-type") ?? "";
  const ext = path.extname(new URL(url).pathname).toLowerCase();
  // Servers often send PDFs and DOCX files as application/octet-stream
  const type = contentType && !contentType.includes("octet-stream") ? contentType : ext || "text/html";
  const binary = /pdf|wordprocessingml/.test(type) || ext === ".pdf" || ext === ".docx";
  const data = binary ? Buffer.from(await res.arrayBuffer()) : await res.text();
  return { id: url, content: await parseDocument(data, binary && ext ? ext : type), metadata: { source: url, type: contentType || ext } };
}

/**
 * loadDocuments
 * Reads files, folders (recursively) and http(s) URLs into documents for evaluate().
 * File ids are relative to each source's parent folder ("docs/a/b.md"), so they
 * stay short wherever the code runs from.
 * @param {string|string[]} sources
 * @param {object} [options]
 * @param {string} [options.cwd=process.cwd()] - Base for relative paths
 * @param {number} [options.concurrency=4] - Files parsed at once
 * @param {function} [options.fetch] - Custom fetch for URLs
 * @returns {Promise<Array<{id: string, content: string, metadata: object}>>}
 */
async function loadDocuments(sources, options = {}) {
  const { cwd = process.cwd(), concurrency = 4, fetch: fetchImpl = globalThis.fetch } = options;

  const jobs = [];
  for (const source of [sources].flat()) {
    if (isURL(source)) {
      jobs.push(() => loadURL(source, fetchImpl));
      continue;
    }
    const root = path.resolve(cwd, source);
    const base = path.dirname(root);
    for (const file of collectFiles(root)) {
      jobs.push(async () => {
        const ext = path.extname(file).toLowerCase();
        let content;
        try {
          content = await parseDocument(fs.readFileSync(file), ext);
        } catch (err) {
          if (String(err.message).startsWith("[ragforge] Reading")) throw err;
          throw new Error(`[ragforge] Could not read ${file}: ${err.message || err}`);
        }
        return {
          id: path.relative(base, file).split(path.sep).join("/"),
          content,
          metadata: { source: file, type: ext },
        };
      });
    }
  }

  const docs = await mapLimit(jobs, concurrency, (job) => job());
  // Scanned PDFs and empty files have no text to index
  return docs.filter((d) => d.content && d.content.trim());
}

module.exports = { loadDocuments, parseDocument, htmlToText, collectFiles, SUPPORTED_EXTENSIONS };
