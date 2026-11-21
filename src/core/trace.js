// Traces: one record per auto() / ragPipeline() call, so real queries can be
// logged in production and evaluated later (`ragforge label`, `eval --from-logs`)
const fs = require("fs");
const path = require("path");

/**
 * buildTrace
 * What happened in one call: the query, the route taken, the passages the
 * answer was written from, the answer and its usage.
 * @param {"auto"|"ragPipeline"} type
 * @param {object} result - Finished pipeline result, with stats
 */
function buildTrace(type, result) {
  const route = result.route
    ? { technique: result.route.technique, category: result.route.category, decidedBy: result.route.decidedBy, reason: result.route.reason }
    : null;
  return {
    timestamp: new Date().toISOString(),
    type,
    query: result.query,
    route,
    sources: (result.sources ?? []).map((s) => ({ ref: s.ref, id: s.id, score: s.score, cited: Boolean(s.cited), content: s.content })),
    citations: result.citations ?? [],
    answer: result.answer ?? null,
    stats: result.stats ?? null,
  };
}

/**
 * createTraceLogger
 * Returns an onTrace hook that appends each trace to a JSONL file (one JSON object per line).
 * @param {string} file
 * @param {object} [options]
 * @param {boolean} [options.includeText=true] - false leaves out passage text and answers,
 *   keeping queries, routes, source ids and stats
 */
function createTraceLogger(file, { includeText = true } = {}) {
  let ready = false;
  return (trace) => {
    if (!ready) {
      fs.mkdirSync(path.dirname(path.resolve(file)), { recursive: true });
      ready = true;
    }
    const record = includeText ? trace : { ...trace, answer: undefined, sources: trace.sources.map(({ content, ...rest }) => rest) };
    fs.appendFileSync(file, `${JSON.stringify(record)}\n`);
  };
}

// onTrace option: a function, or a file path as shorthand for createTraceLogger(path)
function resolveTrace(option) {
  if (!option) return null;
  if (typeof option === "function") return option;
  if (typeof option === "string") return createTraceLogger(option);
  throw new Error("[ragforge] onTrace must be a function or a file path");
}

/**
 * readTraces
 * Reads a JSONL trace file. Lines that aren't JSON or have no query are skipped
 * and counted, so one bad line doesn't lose the log.
 * @returns {{ traces: object[], skipped: number }}
 */
function readTraces(file) {
  const traces = [];
  let skipped = 0;
  for (const line of fs.readFileSync(file, "utf8").split(/\r?\n/)) {
    if (!line.trim()) continue;
    try {
      const record = JSON.parse(line);
      const query = typeof record?.query === "string" ? record.query : record?.question;
      if (typeof query !== "string" || !query.trim()) throw new Error("no query");
      traces.push({ ...record, query: query.trim() });
    } catch {
      skipped++;
    }
  }
  return { traces, skipped };
}

const queryKey = (query) => String(query).trim().toLowerCase().replace(/\s+/g, " ");

/**
 * uniqueQueries
 * Each distinct query once (case and spacing ignored), in log order, with how often it was asked
 * @returns {Array<{ query: string, count: number, trace: object }>}
 */
function uniqueQueries(traces) {
  const seen = new Map();
  for (const trace of traces) {
    const key = queryKey(trace.query);
    if (seen.has(key)) seen.get(key).count++;
    else seen.set(key, { query: trace.query, count: 1, trace });
  }
  return [...seen.values()];
}

/**
 * sample
 * `n` items spread evenly over the list. The same list and n always give the same sample.
 */
function sample(items, n) {
  if (n >= items.length) return [...items];
  return Array.from({ length: n }, (_, i) => items[Math.floor((i * items.length) / n)]);
}

module.exports = { buildTrace, createTraceLogger, resolveTrace, readTraces, uniqueQueries, sample, queryKey };
