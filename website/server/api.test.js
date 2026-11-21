// Run with: npm test
const test = require("node:test");
const assert = require("node:assert/strict");
const { createApp } = require("./app");
const { cleanReadme, slugify } = require("./content");

let server;
let base;

test.before(async () => {
  server = createApp({ dist: "/nonexistent", limit: { max: 1000 } }).listen(0);
  await new Promise((resolve) => server.once("listening", resolve));
  base = `http://127.0.0.1:${server.address().port}`;
});

test.after(() => server.close());

const get = async (path) => {
  const res = await fetch(base + path);
  return { status: res.status, body: await res.json() };
};

const post = async (path, body) => {
  const res = await fetch(base + path, { method: "POST", headers: { "Content-Type": "application/json" }, body: typeof body === "string" ? body : JSON.stringify(body) });
  return { status: res.status, body: await res.json() };
};

test("meta reports the package version and router rules", async () => {
  const { status, body } = await get("/api/meta");
  assert.equal(status, 200);
  assert.match(body.version, /^\d+\.\d+\.\d+/);
  assert.equal(body.rules.comparison, "fanout");
  assert.ok(body.indexedPassages > 20);
});

test("docs are split into sections with anchors and no leftover HTML", async () => {
  const { body } = await get("/api/docs");
  const ids = body.sections.map((s) => s.id);
  assert.ok(ids.includes("quick-start"));
  assert.ok(ids.includes("api-reference"));
  for (const s of body.sections) assert.doesNotMatch(s.markdown, /<\/?(details|summary|sub|div)\b/);
});

test("changelog lists releases newest first", async () => {
  const { body } = await get("/api/changelog");
  assert.ok(body.releases.length >= 3);
  assert.match(body.releases[0].version, /^\d+\.\d+\.\d+$/);
  assert.match(body.releases[0].date, /^\d{4}-\d{2}-\d{2}$/);
});

test("search finds an exact option name", async () => {
  const { status, body } = await get("/api/search?q=rerankK");
  assert.equal(status, 200);
  assert.equal(body.engine, "bm25");
  assert.ok(body.results.length > 0);
  assert.match(body.results[0].snippet, /rerankK/);
  assert.ok(body.results[0].anchor);
});

test("search rejects bad input", async () => {
  assert.equal((await get("/api/search")).status, 400);
  assert.equal((await get("/api/search?q=x&k=99")).status, 400);
  assert.equal((await get(`/api/search?q=${"a".repeat(301)}`)).status, 400);
});

test("route classifies a comparison and picks fanout", async () => {
  const { status, body } = await post("/api/route", { query: "PostgreSQL vs MySQL for analytics" });
  assert.equal(status, 200);
  assert.equal(body.category, "comparison");
  assert.equal(body.technique, "fanout");
  assert.deepEqual(body.pipeline, { techniques: ["fanout"], hybrid: false, rerank: false });
});

test("route keeps exact terms on plain search", async () => {
  const { body } = await post("/api/route", { query: "What does error E404 mean?" });
  assert.equal(body.category, "exact");
  assert.equal(body.technique, "baseline");
  assert.deepEqual(body.pipeline.techniques, []);
});

test("route rejects bad bodies", async () => {
  assert.equal((await post("/api/route", {})).status, 400);
  assert.equal((await post("/api/route", "{not json")).status, 400);
  assert.equal((await post("/api/route", { query: 42 })).status, 400);
});

test("unknown endpoints answer 404 as JSON", async () => {
  const { status, body } = await get("/api/nope");
  assert.equal(status, 404);
  assert.match(body.error, /No such endpoint/);
});

test("cleanReadme turns a details block into a heading", () => {
  const md = "## Quick start\n\ntext\n\n<details>\n<summary><b>Free and local</b></summary>\n\nbody\n\n</details>\n";
  assert.equal(cleanReadme(md), "## Quick start\n\ntext\n\n### Free and local\n\nbody");
});

test("slugify matches GitHub anchors", () => {
  assert.equal(slugify("Why ragforge?"), "why-ragforge");
  assert.equal(slugify("Cost, caching and logging"), "cost-caching-and-logging");
  assert.equal(slugify("`createRagforge(options)`"), "createragforgeoptions");
});

test("search keeps underscores in names", async () => {
  const { body } = await get("/api/search?q=search_docs");
  assert.ok(body.results.length > 0);
  assert.match(body.results[0].snippet, /search_docs/);
  assert.doesNotMatch(body.results[0].snippet, /`/);
});
