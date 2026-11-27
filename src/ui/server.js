// `ragforge ui`: a local dashboard for eval runs, tune runs, trace logs and saved indexes.
// Plain Node.js http, no dependencies. It only listens on the loopback interface, answers
// requests addressed to it by name (no DNS rebinding), reads only the files it found, and
// its one endpoint that can spend money (search) refuses cross-site requests.
const http = require("http");
const fs = require("fs");
const path = require("path");
const crypto = require("crypto");
const { compareEvals } = require("../eval/compare");
const { paretoChart } = require("../tune/report");
const { loadIndex } = require("../indexing/persistentIndex");
const { renderApp } = require("./app");
const pkg = require("../../package.json");

const DEFAULT_PORT = 4321;
const MAX_FILE_BYTES = 64 * 1024 * 1024;
const MAX_FILES = 2000;
const MAX_DEPTH = 6;
const MAX_TRACES = 5000;
// Folders that never hold results; hidden folders are skipped too, except .ragforge (saved indexes)
const SKIP_DIRS = new Set(["node_modules", "dist", "build", "coverage", "out", "vendor"]);

/**
 * classify
 * What a JSON file is, from its shape: an eval result, a tune result, a saved
 * index's manifest or a tuned config. Anything else is not shown.
 */
function classify(data, name) {
  if (!data || typeof data !== "object" || Array.isArray(data)) return null;
  if (Array.isArray(data.results) && Array.isArray(data.ranking) && Array.isArray(data.questions) && typeof data.topK === "number") return "eval";
  if (Array.isArray(data.trials) && Array.isArray(data.pareto) && data.config) return "tune";
  if (name === "manifest.json" && data.settings && data.documents && typeof data.chunkCount === "number") return "index";
  if (data.version === 1 && data.chunking && typeof data.technique === "string") return "config";
  return null;
}

function summarize(kind, data) {
  if (kind === "eval") {
    return {
      questions: data.questionCount,
      topK: data.topK,
      techniques: data.results.length,
      recommended: data.recommendation?.technique ?? null,
      best: Math.max(...data.results.map((r) => r.hitRate)),
      answers: Boolean(data.answers),
      provider: data.provider ? `${data.provider.llm} ${data.provider.chatModel ?? ""} / ${data.provider.embeddingModel ?? ""}`.trim() : null,
    };
  }
  if (kind === "tune") {
    const best = data.trials.find((t) => t.id === data.best);
    return { trials: data.trials.length, questions: data.questionCount, best: data.best, hitRate: best?.hitRate ?? null, spent: data.spent?.costUSD ?? null };
  }
  if (kind === "index") return { chunks: data.chunkCount, documents: Object.keys(data.documents).length, embeddings: data.settings.embeddings, chunking: data.settings.chunking };
  if (kind === "config") return { technique: data.technique, chunking: data.chunking, embeddingModel: data.embeddingModel ?? null };
  if (kind === "traces") return { traces: data.length };
  return {};
}

function readTraceLines(text) {
  const traces = [];
  let skipped = 0;
  for (const line of text.split(/\r?\n/)) {
    if (!line.trim()) continue;
    try {
      const t = JSON.parse(line);
      const query = t?.query ?? t?.question;
      if (typeof query === "string") traces.push({ ...t, query });
      else skipped++;
    } catch {
      skipped++;
    }
  }
  return { traces, skipped };
}

/**
 * createCatalog
 * Finds the files the dashboard can show under `root`, and reads them. Reads are cached
 * by modification time, so a run written while the dashboard is open shows up on reload.
 */
function createCatalog(root) {
  const cache = new Map();

  function load(full, stat) {
    const hit = cache.get(full);
    if (hit && hit.mtimeMs === stat.mtimeMs && hit.size === stat.size) return hit.entry;
    let entry = null;
    try {
      const text = fs.readFileSync(full, "utf8");
      const name = path.basename(full);
      if (name.endsWith(".jsonl")) {
        const { traces, skipped } = readTraceLines(text);
        if (traces.length) entry = { kind: "traces", data: traces, skipped };
      } else {
        const data = JSON.parse(text);
        const kind = classify(data, name);
        if (kind) entry = { kind, data };
      }
    } catch {
      entry = null;
    }
    cache.set(full, { mtimeMs: stat.mtimeMs, size: stat.size, entry });
    return entry;
  }

  function scan() {
    const files = [];
    const walk = (dir, depth) => {
      if (depth > MAX_DEPTH || files.length >= MAX_FILES) return;
      let entries;
      try {
        entries = fs.readdirSync(dir, { withFileTypes: true });
      } catch {
        return;
      }
      for (const e of entries) {
        if (files.length >= MAX_FILES) return;
        const full = path.join(dir, e.name);
        if (e.isDirectory()) {
          if (SKIP_DIRS.has(e.name) || (e.name.startsWith(".") && e.name !== ".ragforge")) continue;
          walk(full, depth + 1);
          continue;
        }
        if (!e.isFile() || !/\.jsonl?$/i.test(e.name)) continue;
        let stat;
        try {
          stat = fs.statSync(full);
        } catch {
          continue;
        }
        if (stat.size > MAX_FILE_BYTES) continue;
        // A saved index is shown by its manifest; its chunks file is read only to search it
        if (e.name === "chunks.json" && fs.existsSync(path.join(dir, "manifest.json"))) continue;
        const entry = load(full, stat);
        if (!entry) continue;
        const id = path.relative(root, full).split(path.sep).join("/");
        files.push({ id, kind: entry.kind, name: e.name, modified: stat.mtime.toISOString(), size: stat.size, summary: summarize(entry.kind, entry.data) });
      }
    };
    walk(root, 0);
    return files.sort((a, b) => b.modified.localeCompare(a.modified));
  }

  // Only a path the scan found is ever read: no "..", absolute paths or other files
  function get(id) {
    if (typeof id !== "string" || !id) return null;
    const found = scan().find((f) => f.id === id);
    if (!found) return null;
    const full = path.join(root, ...found.id.split("/"));
    const entry = load(full, fs.statSync(full));
    return entry ? { ...found, full, data: entry.data, skipped: entry.skipped } : null;
  }

  return { scan, get };
}

/**
 * questionChanges
 * Questions asked in both runs, matched by text, whose rank changed for a technique
 * that ran in both: what got better and what got worse.
 */
function questionChanges(before, after) {
  const key = (q) => String(q.question ?? "").trim().toLowerCase();
  const earlier = new Map(before.questions.map((q) => [key(q), q]));
  const techniques = after.techniques.filter((t) => before.techniques.includes(t));
  const changes = [];
  for (const q of after.questions) {
    const b = earlier.get(key(q));
    if (!b) continue;
    for (const t of techniques) {
      const was = b.runs?.[t]?.rank ?? 0;
      const now = q.runs?.[t]?.rank ?? 0;
      if (was === now) continue;
      const better = now > 0 && (was === 0 || now < was);
      changes.push({ question: q.question, technique: t, before: was, after: now, change: better ? "better" : "worse" });
    }
  }
  return { shared: after.questions.filter((q) => earlier.has(key(q))).length, changes };
}

/**
 * startUiServer
 * @param {object} options
 * @param {string} [options.dir=process.cwd()] - Folder to look for results in (and below)
 * @param {number} [options.port=4321] - 0 picks a free port
 * @param {string} [options.host="127.0.0.1"] - Loopback only, unless you change it
 * @param {function} [options.createRagforge] - Builds the instance for live search (tests replace it)
 * @param {function} [options.createProvider] - (name, options) => embeddings provider for live search
 * @returns {Promise<{ url, port, server, close() }>}
 */
async function startUiServer(options = {}) {
  const root = path.resolve(options.dir ?? process.cwd());
  if (!fs.existsSync(root) || !fs.statSync(root).isDirectory()) throw new Error(`[ragforge] ui: ${root} is not a folder`);
  const host = options.host ?? "127.0.0.1";
  const catalog = createCatalog(root);
  const factory = options.createRagforge ?? require("../createRagforge").createRagforge;
  const makeProvider = options.createProvider ?? ((name, opts) => require("../providers").createBuiltInProvider(name, opts));
  const instances = new Map();
  let port = options.port ?? DEFAULT_PORT;

  // A loaded index and the instance that searches it, rebuilt when the index is saved again
  function searcher(file) {
    const cached = instances.get(file.id);
    if (cached && cached.modified === file.modified) return cached;
    const settings = file.data.settings;
    let rf = null;
    let embeddings = null;
    if (settings.embeddings) {
      const [name, ...model] = settings.embeddings.split(":");
      const embedder = makeProvider(name, { embeddingModel: model.join(":") });
      // Only baseline and hybrid are offered: they make no chat call, so the embedder is enough
      rf = factory({ llm: embedder, embeddings: embedder });
      embeddings = `${embedder.name}:${embedder.embeddingModel}`;
    }
    const loaded = loadIndex(path.dirname(file.full), { embeddings: settings.embeddings ? embeddings : null });
    if (rf) rf.setVectorStore(loaded.store);
    const entry = { modified: file.modified, rf, store: loaded.store, entries: loaded.entries };
    instances.set(file.id, entry);
    return entry;
  }

  async function search(body) {
    const file = catalog.get(body.index);
    if (!file || file.kind !== "index") return { status: 404, json: { error: "No such index" } };
    const query = typeof body.query === "string" ? body.query.trim() : "";
    if (!query) return { status: 400, json: { error: "Type a query" } };
    const topK = Number.isInteger(body.topK) && body.topK >= 1 && body.topK <= 20 ? body.topK : 5;
    const technique = ["baseline", "hybrid", "keyword"].includes(body.technique) ? body.technique : "hybrid";
    const s = searcher(file);
    const context = new Map(s.entries.map((e) => [e.id, e.context ?? null]));
    const started = Date.now();
    let results;
    let stats = null;
    if (technique === "keyword" || !s.rf) {
      results = (await s.store.searchText(query, topK)).map((r, i) => ({ ref: i + 1, id: r.id, score: r.score, content: r.content }));
    } else {
      const out = await s.rf.retrieve(query, { technique, topK });
      // Hybrid fuses two ranked lists (RRF): each passage's score comes from whichever list it was
      // found in, cosine or BM25, which aren't comparable. Its rank is the result, so no score is shown
      results = out.sources.map((x) => ({ ref: x.ref, id: x.id, score: technique === "hybrid" ? null : x.score, content: x.content }));
      stats = out.stats;
    }
    return {
      status: 200,
      json: { query, technique: s.rf ? technique : "keyword", results: results.map((r) => ({ ...r, context: context.get(r.id) ?? null })), stats, latencyMs: Date.now() - started },
    };
  }

  function api(url) {
    if (url.pathname === "/api/files") return { status: 200, json: { root, version: pkg.version, files: catalog.scan() } };
    if (url.pathname === "/api/file") {
      const file = catalog.get(url.searchParams.get("path"));
      if (!file) return { status: 404, json: { error: "Not found. The file may have been moved or deleted: reload the list." } };
      const { full, ...meta } = file;
      if (file.kind === "tune") return { status: 200, json: { ...meta, chart: paretoChart(file.data) } };
      if (file.kind === "traces") {
        const traces = file.data.slice(-MAX_TRACES);
        return { status: 200, json: { ...meta, data: traces, total: file.data.length, shown: traces.length } };
      }
      return { status: 200, json: meta };
    }
    if (url.pathname === "/api/compare") {
      const a = catalog.get(url.searchParams.get("a"));
      const b = catalog.get(url.searchParams.get("b"));
      if (!a || !b || a.kind !== "eval" || b.kind !== "eval") return { status: 404, json: { error: "Pick two eval runs" } };
      const drop = url.searchParams.get("failOnDrop");
      const failOnDrop = drop === null || drop === "" ? undefined : Number(drop);
      if (failOnDrop !== undefined && !(failOnDrop >= 0)) return { status: 400, json: { error: "failOnDrop must be a number of points, 0 or more" } };
      try {
        const comparison = compareEvals(a.data, b.data, { failOnDrop });
        return { status: 200, json: { baseline: a.id, current: b.id, comparison, questions: questionChanges(a.data, b.data) } };
      } catch (err) {
        return { status: 400, json: { error: err.message } };
      }
    }
    return { status: 404, json: { error: "Unknown endpoint" } };
  }

  // Requests must be addressed to this server by its loopback name: a web page on another
  // domain that points its DNS at 127.0.0.1 (DNS rebinding) is refused
  function allowedHost(req) {
    const value = String(req.headers.host ?? "").toLowerCase();
    const names = new Set([`127.0.0.1:${port}`, `localhost:${port}`, `[::1]:${port}`]);
    if (host !== "127.0.0.1" && host !== "localhost" && host !== "::1") names.add(`${host}:${port}`);
    return names.has(value);
  }

  function sameOrigin(req) {
    const origin = req.headers.origin;
    if (!origin) return true;
    return [`http://127.0.0.1:${port}`, `http://localhost:${port}`, `http://[::1]:${port}`].includes(origin);
  }

  function send(res, status, body, type, extra = {}) {
    res.writeHead(status, {
      "Content-Type": type,
      "Cache-Control": "no-store",
      "X-Content-Type-Options": "nosniff",
      "Referrer-Policy": "no-referrer",
      "X-Frame-Options": "DENY",
      ...extra,
    });
    res.end(body);
  }
  const sendJson = (res, status, json) => send(res, status, JSON.stringify(json), "application/json; charset=utf-8");

  const server = http.createServer(async (req, res) => {
    try {
      if (!allowedHost(req)) return send(res, 403, "Forbidden: open the dashboard at its 127.0.0.1 or localhost address.", "text/plain; charset=utf-8");
      const url = new URL(req.url, `http://${req.headers.host}`);
      if (req.method === "GET" && (url.pathname === "/" || url.pathname === "/index.html")) {
        const nonce = crypto.randomBytes(16).toString("base64");
        return send(res, 200, renderApp({ nonce }), "text/html; charset=utf-8", {
          "Content-Security-Policy": `default-src 'none'; script-src 'nonce-${nonce}'; style-src 'nonce-${nonce}'; img-src 'self' data:; connect-src 'self'; base-uri 'none'; form-action 'none'; frame-ancestors 'none'`,
        });
      }
      if (req.method === "GET" && url.pathname.startsWith("/api/")) {
        const out = api(url);
        return sendJson(res, out.status, out.json);
      }
      if (req.method === "POST" && url.pathname === "/api/search") {
        // Search can make embedding calls: only from this dashboard, only as JSON
        if (!sameOrigin(req) || !/^application\/json\b/i.test(String(req.headers["content-type"] ?? ""))) {
          return sendJson(res, 403, { error: "Search only works from the dashboard itself" });
        }
        let raw = "";
        for await (const chunk of req) {
          raw += chunk;
          if (raw.length > 64 * 1024) return sendJson(res, 413, { error: "Request too large" });
        }
        let body;
        try {
          body = JSON.parse(raw || "{}");
        } catch {
          return sendJson(res, 400, { error: "Invalid JSON" });
        }
        try {
          const out = await search(body);
          return sendJson(res, out.status, out.json);
        } catch (err) {
          return sendJson(res, 500, { error: err.message || String(err) });
        }
      }
      if (req.method !== "GET" && req.method !== "POST") return send(res, 405, "Method not allowed", "text/plain; charset=utf-8");
      return send(res, 404, "Not found", "text/plain; charset=utf-8");
    } catch (err) {
      return sendJson(res, 500, { error: err.message || String(err) });
    }
  });

  // The default port moves up when it is taken; a port you chose is an error when taken
  const tries = options.port === undefined ? 10 : 1;
  for (let attempt = 0; attempt < tries; attempt++) {
    try {
      await new Promise((resolve, reject) => {
        server.once("error", reject);
        server.listen(port, host, () => {
          server.off("error", reject);
          resolve();
        });
      });
      break;
    } catch (err) {
      if (err.code !== "EADDRINUSE" || attempt === tries - 1) {
        if (err.code === "EADDRINUSE") throw new Error(`[ragforge] ui: port ${port} is in use. Pick another with --port.`);
        throw err;
      }
      port++;
    }
  }
  port = server.address().port;
  const shownHost = host === "127.0.0.1" || host === "::1" || host === "0.0.0.0" ? "127.0.0.1" : host;
  return {
    url: `http://${shownHost}:${port}`,
    port,
    server,
    files: () => catalog.scan(),
    close: () => new Promise((resolve) => server.close(() => resolve())),
  };
}

module.exports = { startUiServer, createCatalog, classify, questionChanges, DEFAULT_PORT };
