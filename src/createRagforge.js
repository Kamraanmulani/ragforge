// Factory for configured ragforge instances
const defaults = require("./config/defaults");
const { resolveProvider } = require("./providers");
const { resolveCache } = require("./core/cache");
const { resolveReranker } = require("./rerankers");
const { DEFAULT_PRICING } = require("./core/pricing");
const { createCallContext } = require("./core/context");
const { resolveLogger } = require("./core/utils");
const { buildTrace, resolveTrace } = require("./core/trace");
const { hyde } = require("./techniques/hyde");
const { cot } = require("./techniques/cot");
const { stepback } = require("./techniques/stepback");
const { fanout } = require("./techniques/fanout");
const { rrf } = require("./techniques/rrf");
const { translate } = require("./pipeline/queryTranslator");
const { ragPipeline } = require("./pipeline/ragPipeline");
const { evaluate } = require("./eval/evaluate");
const { route, pipelineTechniques, usesHybrid, usesRerank, usesContextual } = require("./router/route");
const { contextualize, estimateContextCost } = require("./indexing/contextual");

/**
 * createRagforge
 * @param {object} options
 * @param {string|object} [options.llm] - "openai" (default), "ollama", or a provider object
 * @param {string|object} [options.embeddings] - Embedding provider (defaults to llm)
 * @param {object} [options.vectorStore] - { query(vector, topK), searchText?(text, topK) }
 * @param {boolean} [options.hybrid] - Default for ragPipeline/auto: add keyword search (needs searchText)
 * @param {string|object} [options.reranker] - "llm", "cohere", "jina", or { rerank() }
 * @param {boolean} [options.rerank] - Default for ragPipeline/auto: rerank retrieved candidates
 * @param {boolean|object} [options.cache] - true for in-memory, or { get, set }
 * @param {object} [options.pricing] - Extra/overridden USD prices per 1M tokens
 * @param {object} [options.defaults] - Default LLM options (model, temperature, ...)
 * @param {boolean} [options.debug] - Log progress to console
 * @param {object} [options.logger] - Custom { info, error } logger
 * @param {function|string} [options.onTrace] - Called with a trace of every auto() and ragPipeline() call
 *   (query, route, sources, answer, stats). A file path appends the traces to that file as JSONL
 */
function createRagforge(options = {}) {
  const llm = resolveProvider(options.llm ?? "openai");
  const embedder = options.embeddings ? resolveProvider(options.embeddings) : llm;

  const config = {
    llm,
    embedder,
    vectorStore: options.vectorStore ?? null,
    hybrid: options.hybrid ?? false,
    reranker: resolveReranker(options.reranker),
    rerank: options.rerank ?? false,
    cache: resolveCache(options.cache),
    logger: resolveLogger(options.logger, options.debug),
    pricing: { ...DEFAULT_PRICING, ...options.pricing },
    defaults: { ...defaults, ...options.defaults },
  };
  const onTrace = resolveTrace(options.onTrace);

  // Tracing is for observing: a failing hook must never fail the call it observes
  function trace(type, result) {
    if (!onTrace) return;
    try {
      onTrace(buildTrace(type, result));
    } catch (err) {
      config.logger.error(`[ragforge] onTrace failed: ${err.message || err}`);
    }
  }

  // Each public call gets its own context so stats never mix between calls
  async function run(fn, callOptions = {}) {
    const ctx = createCallContext(config);
    const result = await fn(ctx);
    // A streamed call reports its stats when the stream ends, see withStats()
    if (!callOptions.stream && typeof callOptions.onStats === "function") callOptions.onStats(ctx.tracker.snapshot());
    return result;
  }

  // Adds stats to a pipeline result and traces the call. For a stream, both happen after the last token.
  function withStats(ctx, result, callOptions, type) {
    if (!result.stream) {
      const finished = { ...result, stats: ctx.tracker.snapshot() };
      trace(type, finished);
      return finished;
    }
    const stats = result.done.then((final) => {
      const snapshot = ctx.tracker.snapshot();
      if (typeof callOptions.onStats === "function") callOptions.onStats(snapshot);
      trace(type, { ...result, ...final, stats: snapshot });
      return snapshot;
    });
    stats.catch(() => {});
    return { ...result, stats };
  }

  return {
    hyde: (query, opts = {}) => run((ctx) => hyde(ctx, query, opts), opts),
    cot: (query, opts = {}) => run((ctx) => cot(ctx, query, opts), opts),
    stepback: (query, opts = {}) => run((ctx) => stepback(ctx, query, opts), opts),
    fanout: (query, opts = {}) => run((ctx) => fanout(ctx, query, opts), opts),
    translate: (query, opts = {}) => run((ctx) => translate(ctx, query, opts), opts),

    ragPipeline: (query, opts = {}) =>
      run(async (ctx) => {
        const result = await ragPipeline(ctx, query, { hybrid: config.hybrid, rerank: config.rerank, ...opts });
        return withStats(ctx, result, opts, "ragPipeline");
      }, opts),

    // Picks a technique for the query without running it; see src/router/route.js
    route: (query, opts = {}) => run((ctx) => route(ctx, query, opts), opts),

    // Routes the query, then runs the pipeline with the chosen technique
    auto: (query, opts = {}) =>
      run(async (ctx) => {
        const chosen = await route(ctx, query, opts);
        let hybrid = opts.hybrid ?? (config.hybrid || usesHybrid(chosen.technique));
        // An eval-picked hybrid technique degrades to vector search on a store without keyword search
        if (hybrid && opts.hybrid === undefined && !config.hybrid && !ctx.hasTextSearch()) {
          hybrid = false;
          chosen.reason += " Keyword search was skipped because the vector store has no searchText().";
        }
        let rerank = opts.rerank ?? (config.rerank || usesRerank(chosen.technique));
        if (rerank && opts.rerank === undefined && !config.rerank && !ctx.hasReranker()) {
          rerank = false;
          chosen.reason += " Reranking was skipped because no reranker is configured.";
        }
        // Contextual retrieval happens when the store is indexed; nothing changes at query time
        if (usesContextual(chosen.technique)) {
          chosen.reason += " Contextual retrieval applies to how the vector store is indexed: build it from rf.contextualize() chunks.";
        }
        const result = await ragPipeline(ctx, query, { ...opts, hybrid, rerank, techniques: pipelineTechniques(chosen.technique) });
        return withStats(ctx, { ...result, route: chosen }, opts, "auto");
      }, opts),

    // Benchmarks retrieval techniques; see src/eval/evaluate.js for options
    evaluate: (opts = {}) => evaluate(config, opts),

    // Contextual retrieval: adds an LLM-written context line to each chunk, for indexing.
    // See src/indexing/contextual.js for options
    contextualize: async (chunks, documents, opts = {}) => {
      const ctx = createCallContext(config);
      const result = await contextualize(ctx, config, chunks, documents, opts);
      return { ...result, stats: ctx.tracker.snapshot() };
    },
    estimateContextCost: (chunks, documents, opts = {}) => estimateContextCost(config, chunks, documents, opts),

    callLLM: (prompt, opts = {}) => run((ctx) => ctx.chat(prompt, opts), opts),
    getEmbedding: (text, opts = {}) => run((ctx) => ctx.embed(text, opts.model), opts),

    rrf,

    setVectorStore(store) {
      config.vectorStore = store ?? null;
    },

    llm,
    embedder,
    cache: config.cache,
  };
}

module.exports = { createRagforge };
