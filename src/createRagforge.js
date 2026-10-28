// Factory for configured ragforge instances
const defaults = require("./config/defaults");
const { resolveProvider } = require("./providers");
const { resolveCache } = require("./core/cache");
const { DEFAULT_PRICING } = require("./core/pricing");
const { createCallContext } = require("./core/context");
const { resolveLogger } = require("./core/utils");
const { hyde } = require("./techniques/hyde");
const { cot } = require("./techniques/cot");
const { stepback } = require("./techniques/stepback");
const { fanout } = require("./techniques/fanout");
const { rrf } = require("./techniques/rrf");
const { translate } = require("./pipeline/queryTranslator");
const { ragPipeline } = require("./pipeline/ragPipeline");

/**
 * createRagforge
 * @param {object} options
 * @param {string|object} [options.llm] - "openai" (default), "ollama", or a provider object
 * @param {string|object} [options.embeddings] - Embedding provider (defaults to llm)
 * @param {object} [options.vectorStore] - { query(vector, topK) }
 * @param {boolean|object} [options.cache] - true for in-memory, or { get, set }
 * @param {object} [options.pricing] - Extra/overridden USD prices per 1M tokens
 * @param {object} [options.defaults] - Default LLM options (model, temperature, ...)
 * @param {boolean} [options.debug] - Log progress to console
 * @param {object} [options.logger] - Custom { info, error } logger
 */
function createRagforge(options = {}) {
  const llm = resolveProvider(options.llm ?? "openai");
  const embedder = options.embeddings ? resolveProvider(options.embeddings) : llm;

  const config = {
    llm,
    embedder,
    vectorStore: options.vectorStore ?? null,
    cache: resolveCache(options.cache),
    logger: resolveLogger(options.logger, options.debug),
    pricing: { ...DEFAULT_PRICING, ...options.pricing },
    defaults: { ...defaults, ...options.defaults },
  };

  // Each public call gets its own context so stats never mix between calls
  async function run(fn, callOptions = {}) {
    const ctx = createCallContext(config);
    const result = await fn(ctx);
    if (typeof callOptions.onStats === "function") callOptions.onStats(ctx.tracker.snapshot());
    return result;
  }

  return {
    hyde: (query, opts = {}) => run((ctx) => hyde(ctx, query, opts), opts),
    cot: (query, opts = {}) => run((ctx) => cot(ctx, query, opts), opts),
    stepback: (query, opts = {}) => run((ctx) => stepback(ctx, query, opts), opts),
    fanout: (query, opts = {}) => run((ctx) => fanout(ctx, query, opts), opts),
    translate: (query, opts = {}) => run((ctx) => translate(ctx, query, opts), opts),

    ragPipeline: (query, opts = {}) =>
      run(async (ctx) => {
        const result = await ragPipeline(ctx, query, opts);
        return { ...result, stats: ctx.tracker.snapshot() };
      }, opts),

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
