// Contextual retrieval: at index time, an LLM writes a short line that places each
// chunk in its document ("From the billing guide, section on refunds: ..."). The line
// is embedded and keyword-indexed with the chunk, so a passage that never names its
// subject can still be found. The chunk text shown to users and the LLM is unchanged.
// Costs one LLM call per chunk, so the cost is estimated first and lines are cached.
const crypto = require("crypto");
const { normalizeDocuments } = require("../eval/chunk");
const { findPrice } = require("../core/pricing");
const { mapLimit } = require("../core/limit");
const { sanitizeText } = require("../core/utils");

// Part of every cache key. The key also hashes the full prompt, so a wording change
// never reuses old lines; bump this for changes outside the prompt (e.g. cleanContext)
const CONTEXT_VERSION = 1;
const DEFAULT_MAX_DOCUMENT_CHARS = 24000;
const MAX_CONTEXT_TOKENS = 80;
// Rough output length used for the estimate; a line is one sentence of up to 25 words
const ESTIMATED_OUTPUT_TOKENS = 40;
const MAX_CONTEXT_CHARS = 500;

/**
 * documentWindow
 * The document text shown with a chunk. A document over `maxChars` is cut to a
 * window around the chunk's position, so long PDFs don't overflow the model or the budget.
 */
function documentWindow(text, position, maxChars) {
  if (text.length <= maxChars) return text;
  const center = Math.round(position * text.length);
  const start = Math.max(0, Math.min(text.length - maxChars, center - Math.floor(maxChars / 2)));
  return `${start > 0 ? "[...] " : ""}${text.slice(start, start + maxChars)}${start + maxChars < text.length ? " [...]" : ""}`;
}

function contextPrompt(documentText, chunk) {
  return `<document>
${documentText}
</document>

Here is a passage from the document above:
<passage>
${chunk}
</passage>

Write one short sentence, at most 25 words, that situates this passage within the document to improve search retrieval of the passage. Name the document's subject (the product, project or organisation) and the specific topic of this passage. Describe only this passage, not the document's other sections. Don't start with "This document" or "This passage", and don't repeat the passage. Answer with the sentence only.`;
}

function cleanContext(text) {
  const clean = sanitizeText(String(text ?? ""))
    .replace(/^(context|situating context)\s*:\s*/i, "")
    .replace(/^["'“]+|["'”]+$/g, "")
    .trim();
  return clean.length > MAX_CONTEXT_CHARS ? `${clean.slice(0, MAX_CONTEXT_CHARS - 1).trimEnd()}…` : clean;
}

const tokens = (text) => Math.ceil(text.length / 4);

// "$0.0123", "<$0.0001", "$0" or "cost unknown", for log lines
function formatCost(usd) {
  if (usd === null || usd === undefined) return "cost unknown";
  if (usd === 0) return "$0";
  return usd < 0.0001 ? "<$0.0001" : `$${usd.toFixed(4)}`;
}

/**
 * estimateLine
 * The estimate in one line, printed before any context line is written
 */
function estimateLine(e) {
  const cost = e.calls === 0 ? "nothing to pay" : e.costUSD === null ? `cost unknown (no price for ${e.model})` : e.costUSD === 0 ? "free" : `estimated ${formatCost(e.costUSD)}`;
  const cached = e.cached ? `, ${e.cached} cached` : "";
  return `Contextual retrieval: ${e.chunks} chunk${e.chunks === 1 ? "" : "s"}${cached}, ${e.calls} LLM call${e.calls === 1 ? "" : "s"} with ${e.model}, ${cost}.`;
}

/**
 * doneLine
 * What contextualize() did, for "Indexed ..." messages: "with context lines: 3 cached, cost $0.0004"
 */
function doneLine(result) {
  const parts = [];
  if (result.cached) parts.push(`${result.cached} cached`);
  if (result.failed) parts.push(`${result.failed} failed`);
  parts.push(`cost ${formatCost(result.stats?.costUSD)}`);
  return `with context lines: ${parts.join(", ")}`;
}

/**
 * plan
 * One job per chunk: its prompt and cache key. Chunks whose document isn't in
 * `documents` (e.g. from another call) can't be placed and are rejected.
 */
function plan(chunks, documents, { model, maxDocumentChars }) {
  const docs = new Map(normalizeDocuments(documents).map((d) => [d.docId, d.content]));
  const perDoc = new Map();
  for (const c of chunks) perDoc.set(c.docId, (perDoc.get(c.docId) ?? 0) + 1);
  const seen = new Map();

  return chunks.map((chunk) => {
    if (!docs.has(chunk.docId)) {
      throw new Error(`[ragforge] contextualize: chunk "${chunk.id}" belongs to document "${chunk.docId}", which is not in documents. Pass the same documents you chunked.`);
    }
    const index = seen.get(chunk.docId) ?? 0;
    seen.set(chunk.docId, index + 1);
    const window = documentWindow(docs.get(chunk.docId), (index + 0.5) / perDoc.get(chunk.docId), maxDocumentChars);
    const prompt = contextPrompt(window, chunk.content);
    // The whole prompt is hashed: a changed chunk, document window or prompt wording gets a new line
    const hash = crypto.createHash("sha256").update(prompt).digest("hex");
    return { chunk, prompt, key: `context:v${CONTEXT_VERSION}:${model}:${hash}` };
  });
}

function resolveOptions(config, options = {}) {
  const llmOptions = { ...options.llmOptions, ...(options.model && { model: options.model }) };
  const model = llmOptions.model ?? config.defaults.model ?? config.llm.chatModel;
  const maxDocumentChars = options.maxDocumentChars ?? DEFAULT_MAX_DOCUMENT_CHARS;
  if (!Number.isInteger(maxDocumentChars) || maxDocumentChars < 1) {
    throw new Error("[ragforge] contextualize: maxDocumentChars must be a positive whole number");
  }
  if (options.budgetUSD !== undefined && !(typeof options.budgetUSD === "number" && options.budgetUSD >= 0)) {
    throw new Error("[ragforge] contextualize: budgetUSD must be a number of US dollars, 0 or more");
  }
  return { llmOptions, model, maxDocumentChars, cache: options.cache ?? null };
}

/**
 * estimateContextCost
 * What contextualizing would cost, before any call is made. Chunks already in
 * the cache are free. Token counts are estimated from characters (about 4 per token).
 * @returns {Promise<{ chunks, cached, calls, inputTokens, outputTokens, model, costUSD }>}
 *   costUSD is null when the model has no known price (add it with `pricing`)
 */
async function estimateContextCost(config, chunks, documents, options = {}) {
  const opts = resolveOptions(config, options);
  if (config.llm.chatModel === null && !opts.llmOptions.model) {
    throw new Error(`[ragforge] contextual retrieval needs a chat model, and the ${config.llm.name} provider has none. Use a chat provider for llm.`);
  }
  const jobs = plan(chunks, documents, opts);
  let cached = 0;
  let inputTokens = 0;
  for (const job of jobs) {
    if (opts.cache && (await opts.cache.get(job.key)) !== undefined) cached++;
    else inputTokens += tokens(job.prompt);
  }
  const calls = jobs.length - cached;
  const outputTokens = calls * ESTIMATED_OUTPUT_TOKENS;
  let costUSD = 0;
  if (calls && !config.llm.free) {
    const price = findPrice(config.pricing, opts.model);
    costUSD = price ? Number(((inputTokens * (price.input ?? 0) + outputTokens * (price.output ?? 0)) / 1e6).toFixed(6)) : null;
  }
  return { chunks: jobs.length, cached, calls, inputTokens, outputTokens, model: opts.model, costUSD };
}

/**
 * contextualize
 * Adds `context` (the LLM's line) and `indexText` (context + chunk, the text to
 * embed and keyword-index) to each chunk. `content` is left as it was.
 *
 * Checks the budget before spending: with `budgetUSD`, it throws when the
 * estimate is higher (or unknown). A chunk whose call fails is indexed without
 * context and counted in `failed`; if every call fails, it throws.
 *
 * @param {object} ctx - Call context (its tracker records the usage)
 * @param {object} config - Instance config
 * @param {Array<{id, docId, content}>} chunks - From chunkDocuments(documents)
 * @param {Array} documents - The documents the chunks came from
 * @param {object} [options]
 * @param {string} [options.model] - Chat model for the context lines (default: the instance's)
 * @param {object} [options.llmOptions] - Other chat options
 * @param {object} [options.cache] - { get, set } for context lines, e.g. createFileCache()
 * @param {number} [options.budgetUSD] - Refuse to start when the estimate is above this
 * @param {number} [options.maxDocumentChars=24000] - Document text shown with each chunk
 * @param {number} [options.concurrency=4]
 * @param {function} [options.onEstimate] - Called with the estimate before any call
 * @param {function} [options.onProgress] - ({ phase: "context", done, total }) => void
 * @returns {Promise<{ chunks, estimate, cached, failed, errors }>}
 */
async function contextualize(ctx, config, chunks, documents, options = {}) {
  const opts = resolveOptions(config, options);
  const { concurrency = 4, onEstimate = () => {}, onProgress = () => {} } = options;

  const estimate = await estimateContextCost(config, chunks, documents, options);
  onEstimate(estimate);
  if (options.budgetUSD !== undefined && estimate.calls > 0) {
    if (estimate.costUSD === null) {
      throw new Error(`[ragforge] contextual retrieval: no price known for ${estimate.model}, so the budget can't be checked. Add its price with createRagforge({ pricing }).`);
    }
    if (estimate.costUSD > options.budgetUSD) {
      throw new Error(`[ragforge] contextual retrieval would cost about $${estimate.costUSD.toFixed(4)} (${estimate.calls} LLM calls with ${estimate.model}), over the budget of $${options.budgetUSD}. Raise the budget, use a cheaper model, or index fewer documents.`);
    }
  }

  const jobs = plan(chunks, documents, opts);
  let cached = 0;
  let done = 0;
  const errors = [];
  const contexts = await mapLimit(jobs, concurrency, async (job) => {
    let context = opts.cache ? await opts.cache.get(job.key) : undefined;
    if (context !== undefined) {
      cached++;
      ctx.tracker.recordCacheHit();
    } else {
      try {
        context = cleanContext(await ctx.chat(job.prompt, { temperature: 0, max_tokens: MAX_CONTEXT_TOKENS, ...opts.llmOptions }));
        if (opts.cache && context) await opts.cache.set(job.key, context);
      } catch (err) {
        errors.push({ id: job.chunk.id, error: err.message || String(err) });
        context = "";
      }
    }
    onProgress({ phase: "context", done: ++done, total: jobs.length });
    return context;
  });
  await opts.cache?.flush?.();

  if (jobs.length && errors.length === jobs.length) {
    throw new Error(`[ragforge] contextual retrieval failed for every chunk: ${errors[0].error}`);
  }
  return {
    chunks: jobs.map((job, i) => ({
      ...job.chunk,
      context: contexts[i],
      indexText: contexts[i] ? `${contexts[i]}\n\n${job.chunk.content}` : job.chunk.content,
    })),
    estimate,
    cached,
    failed: errors.length,
    errors,
  };
}

module.exports = { contextualize, estimateContextCost, estimateLine, doneLine, formatCost, documentWindow, contextPrompt, cleanContext, CONTEXT_VERSION, DEFAULT_MAX_DOCUMENT_CHARS };
