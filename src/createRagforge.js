// Factory for configured ragforge instances
const defaults = require("./config/defaults");
const { resolveProvider, createBuiltInProvider } = require("./providers");
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
const { indexDocuments } = require("./indexing/memoryIndex");
const { classifyQuery } = require("./router/classify");
const { loadConfig } = require("./tune/config");
const { tune } = require("./tune/tune");

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
 * @param {string|object} [options.config] - A ragforge.config.json from `ragforge tune` (object or path).
 *   Sets the providers, models, technique, topK and how rf.index() chunks; inline options win
 */
function createRagforge(options = {}) {
  const tuned = options.config ? Object.freeze(loadConfig(options.config)) : null;
  const fromConfig = (kind, name, opts) => {
    try {
      return createBuiltInProvider(name, opts);
    } catch (err) {
      throw new Error(`${err.message} The config's ${kind} is "${name}": pass ${kind} to createRagforge to use your own provider.`);
    }
  };
  const llm = resolveProvider(options.llm ?? (tuned?.llm ? fromConfig("llm", tuned.llm, tuned.chatModel ? { chatModel: tuned.chatModel } : {}) : "openai"));
  const embedder = options.embeddings
    ? resolveProvider(options.embeddings)
    : tuned?.embeddings
      ? fromConfig("embeddings", tuned.embeddings, tuned.embeddingModel ? { embeddingModel: tuned.embeddingModel } : {})
      : llm;

  const config = {
    llm,
    embedder,
    vectorStore: options.vectorStore ?? null,
    hybrid: options.hybrid ?? tuned?.hybrid ?? false,
    reranker: resolveReranker(options.reranker ?? tuned?.reranker ?? undefined),
    rerank: options.rerank ?? tuned?.rerank ?? false,
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

  // With a tuned config, every query uses the tuned technique unless the call asks to route
  function configRoute(query, opts) {
    if (!tuned || opts.from || opts.router || opts.rules || opts.techniques) return null;
    const t = tuned.tuned;
    const score = t && typeof t.hitRate === "number" ? ` It found the right chunk ${Math.round(t.hitRate * 100)}% of the time on ${t.questions} questions${t.default ? ` vs ${Math.round(t.default.hitRate * 100)}% for the default setup` : ""}.` : "";
    return {
      technique: tuned.technique,
      category: classifyQuery(query).category,
      classifier: "config",
      decidedBy: "config",
      reason: `Tuned with ragforge tune: ${tuned.technique} on ${tuned.chunking.strategy} chunks of ${tuned.chunking.size} characters.${score}`,
    };
  }

  // Defaults from the tuned config for ragPipeline and auto: topK, and the technique's query rewriting
  const pipelineDefaults = (opts) => ({
    ...(tuned && { topK: tuned.topK, techniques: pipelineTechniques(tuned.technique) }),
    ...opts,
  });

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

  const rf = {
    hyde: (query, opts = {}) => run((ctx) => hyde(ctx, query, opts), opts),
    cot: (query, opts = {}) => run((ctx) => cot(ctx, query, opts), opts),
    stepback: (query, opts = {}) => run((ctx) => stepback(ctx, query, opts), opts),
    fanout: (query, opts = {}) => run((ctx) => fanout(ctx, query, opts), opts),
    translate: (query, opts = {}) => run((ctx) => translate(ctx, query, opts), opts),

    ragPipeline: (query, opts = {}) =>
      run(async (ctx) => {
        const result = await ragPipeline(ctx, query, { hybrid: config.hybrid, rerank: config.rerank, ...pipelineDefaults(opts) });
        return withStats(ctx, result, opts, "ragPipeline");
      }, opts),

    // Picks a technique for the query without running it; see src/router/route.js
    route: (query, opts = {}) => run(async (ctx) => configRoute(query, opts) ?? route(ctx, query, opts), opts),

    // Routes the query, then runs the pipeline with the chosen technique
    auto: (query, opts = {}) =>
      run(async (ctx) => {
        const chosen = configRoute(query, opts) ?? (await route(ctx, query, opts));
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
        // Contextual retrieval happens when the store is indexed; nothing changes at query time.
        // A tuned instance indexes that way itself in rf.index()
        if (usesContextual(chosen.technique) && chosen.decidedBy !== "config") {
          chosen.reason += " Contextual retrieval applies to how the vector store is indexed: build it from rf.contextualize() chunks.";
        }
        const result = await ragPipeline(ctx, query, { ...pipelineDefaults(opts), hybrid, rerank, techniques: pipelineTechniques(chosen.technique) });
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

    // Finds the best retrieval setup for your documents within a budget; see src/tune/tune.js
    tune: (opts = {}) => tune(config, opts),

    /**
     * index
     * Chunks and embeds documents into an in-memory store (vectors + BM25) and uses it.
     * With a tuned config, chunking and contextual retrieval follow the config.
     */
    index: (documents, opts = {}) =>
      indexDocuments(rf, documents, {
        ...(tuned && {
          chunkStrategy: tuned.chunking.strategy,
          chunkSize: tuned.chunking.size,
          chunkOverlap: tuned.chunking.overlap,
          contextual: tuned.contextual,
        }),
        ...opts,
      }),

    callLLM: (prompt, opts = {}) => run((ctx) => ctx.chat(prompt, opts), opts),
    getEmbedding: (text, opts = {}) => run((ctx) => ctx.embed(text, opts.model), opts),

    rrf,

    setVectorStore(store) {
      config.vectorStore = store ?? null;
    },

    llm,
    embedder,
    cache: config.cache,
    // The tuned config this instance was created with, or null
    config: tuned,
  };
  return rf;
}

module.exports = { createRagforge };
