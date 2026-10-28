// Per-call context handed to techniques: LLM, embeddings, vector store,
// cache, logging and a fresh stats tracker for this call
const { createTracker } = require("./stats");

/**
 * normalizeChatOptions
 * Accepts both v1 snake_case (max_tokens) and camelCase (maxTokens).
 * Uses ?? so explicit falsy values like temperature: 0 are respected.
 */
function normalizeChatOptions(options, defaults, provider) {
  return {
    model: options.model ?? defaults.model ?? provider.chatModel,
    temperature: options.temperature ?? defaults.temperature,
    maxTokens: options.max_tokens ?? options.maxTokens ?? defaults.maxTokens,
    topP: options.top_p ?? options.topP ?? defaults.topP,
    frequencyPenalty: options.frequency_penalty ?? options.frequencyPenalty ?? defaults.frequencyPenalty,
    presencePenalty: options.presence_penalty ?? options.presencePenalty ?? defaults.presencePenalty,
  };
}

function createCallContext(config) {
  const { llm, embedder, cache, logger, defaults } = config;
  const tracker = createTracker(config.pricing);

  async function chat(prompt, options = {}) {
    const params = { prompt, ...normalizeChatOptions(options, defaults, llm) };
    const key = cache && `chat:${llm.name}:${JSON.stringify(params)}`;

    if (cache) {
      const hit = await cache.get(key);
      if (hit !== undefined) {
        tracker.recordCacheHit();
        return hit;
      }
    }

    let result;
    try {
      result = await llm.chat(params);
    } catch (err) {
      logger.error(`[ragforge] LLM call failed: ${err.message || err}`);
      throw err;
    }

    tracker.recordChat(llm, result.model ?? params.model, result.usage);
    if (cache) await cache.set(key, result.text);
    return result.text;
  }

  async function embed(text, model = embedder.embeddingModel) {
    const key = cache && `embed:${embedder.name}:${model}:${text}`;

    if (cache) {
      const hit = await cache.get(key);
      if (hit !== undefined) {
        tracker.recordCacheHit();
        return hit;
      }
    }

    let result;
    try {
      result = await embedder.embed({ text, model });
    } catch (err) {
      logger.error(`[ragforge] Embedding failed: ${err.message || err}`);
      throw err;
    }

    tracker.recordEmbedding(embedder, result.model ?? model, result.usage);
    if (cache) await cache.set(key, result.vector);
    return result.vector;
  }

  function hasVectorStore() {
    return config.vectorStore !== null;
  }

  async function queryVectors(vector, topK) {
    if (!hasVectorStore()) return [];
    return (await config.vectorStore.query(vector, topK)) ?? [];
  }

  return {
    chat,
    embed,
    hasVectorStore,
    queryVectors,
    log: (msg) => logger.info(msg),
    tracker,
  };
}

module.exports = { createCallContext, normalizeChatOptions };
