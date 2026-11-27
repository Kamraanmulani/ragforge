// JSON API for the site. Every answer comes from the ragforge package itself:
// the router is rf.route(), the search is its BM25 index. No API key is used.
const express = require("express");
const { createRagforge, DEFAULT_RULES } = require("ragforge");
const { pipelineTechniques, usesHybrid, usesRerank } = require("ragforge/src/router/route");
const { loadContent } = require("./content");

const MAX_QUERY = 300;
const MAX_TOP_K = 10;

/**
 * rateLimit
 * Fixed window per client address, in memory. Enough to keep one visitor from
 * hammering a small server; put a real limiter in front for anything bigger.
 */
function rateLimit({ windowMs = 60_000, max = 120 } = {}) {
  const hits = new Map();
  return (req, res, next) => {
    const now = Date.now();
    const key = req.ip ?? "unknown";
    const entry = hits.get(key);
    if (!entry || now - entry.start >= windowMs) {
      hits.set(key, { start: now, count: 1 });
      if (hits.size > 5000) for (const [k, v] of hits) if (now - v.start >= windowMs) hits.delete(k);
      return next();
    }
    if (++entry.count > max) {
      res.set("Retry-After", String(Math.ceil((entry.start + windowMs - now) / 1000)));
      return res.status(429).json({ error: "Too many requests. Try again in a minute." });
    }
    next();
  };
}

function readQuery(value) {
  if (typeof value !== "string" || !value.trim()) return { error: "query must be a non-empty string" };
  if (value.length > MAX_QUERY) return { error: `query must be ${MAX_QUERY} characters or fewer` };
  return { query: value.trim() };
}

/**
 * createApi
 * @param {object} [options]
 * @param {object} [options.content] - From loadContent(); tests pass their own
 * @param {object} [options.limit] - rateLimit options
 */
function createApi(options = {}) {
  const content = options.content ?? loadContent();
  // Rules routing never calls a model, so the default instance needs no key
  const rf = createRagforge();
  const router = express.Router();

  router.use(rateLimit(options.limit));
  router.use(express.json({ limit: "4kb" }));

  router.get("/health", (req, res) => res.json({ ok: true, version: content.version }));

  router.get("/meta", (req, res) => {
    res.json({
      version: content.version,
      description: content.description,
      license: content.license,
      node: content.node,
      links: content.links,
      indexedPassages: content.chunkCount,
      rules: DEFAULT_RULES,
    });
  });

  // Docs and changelog change with every release. "no-cache" still lets the browser keep its
  // copy, but it asks first (the ETag makes that a tiny 304), so a deploy shows up on the next
  // load instead of up to 5 minutes later
  router.get("/docs", (req, res) => {
    res.set("Cache-Control", "no-cache");
    res.json({ version: content.version, sections: content.sections });
  });

  router.get("/changelog", (req, res) => {
    res.set("Cache-Control", "no-cache");
    res.json({ releases: content.releases });
  });

  router.get("/search", (req, res) => {
    const { query, error } = readQuery(req.query.q);
    if (error) return res.status(400).json({ error });
    const k = req.query.k === undefined ? 6 : Number(req.query.k);
    if (!Number.isInteger(k) || k < 1 || k > MAX_TOP_K) {
      return res.status(400).json({ error: `k must be a whole number from 1 to ${MAX_TOP_K}` });
    }
    const started = process.hrtime.bigint();
    const results = content.search(query, k);
    const tookMs = Number(process.hrtime.bigint() - started) / 1e6;
    res.json({ query, engine: "bm25", passages: content.chunkCount, tookMs: Number(tookMs.toFixed(2)), results });
  });

  router.post("/route", async (req, res, next) => {
    try {
      const { query, error } = readQuery(req.body?.query);
      if (error) return res.status(400).json({ error });
      const decision = await rf.route(query);
      res.json({
        query,
        ...decision,
        // What auto() would run for this technique
        pipeline: {
          techniques: pipelineTechniques(decision.technique),
          hybrid: usesHybrid(decision.technique),
          rerank: usesRerank(decision.technique),
        },
      });
    } catch (err) {
      next(err);
    }
  });

  router.use((req, res) => res.status(404).json({ error: `No such endpoint: ${req.method} ${req.originalUrl}` }));

  // eslint-disable-next-line no-unused-vars
  router.use((err, req, res, next) => {
    if (err.type === "entity.parse.failed") return res.status(400).json({ error: "Body must be valid JSON" });
    if (err.type === "entity.too.large") return res.status(413).json({ error: "Body is too large" });
    console.error("[ragforge site]", err);
    res.status(500).json({ error: "Something went wrong on the server." });
  });

  return router;
}

module.exports = { createApi, rateLimit };
