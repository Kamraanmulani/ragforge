// Per-call usage tracking: LLM/embedding/rerank calls, tokens, cost, latency
const { findPrice } = require("./pricing");

function createTracker(pricing) {
  const startedAt = Date.now();
  const totals = {
    llmCalls: 0,
    embeddingCalls: 0,
    rerankCalls: 0,
    cacheHits: 0,
    inputTokens: 0,
    outputTokens: 0,
    costUSD: 0,
  };
  // Becomes false once any call uses a model with no known price
  let costKnown = true;

  function addCost(provider, model, inputTokens, outputTokens, searches = 0) {
    if (provider.free) return;
    const price = findPrice(pricing, model);
    if (!price) {
      costKnown = false;
      return;
    }
    totals.costUSD += (inputTokens * (price.input ?? 0) + outputTokens * (price.output ?? 0)) / 1e6 + searches * (price.perSearch ?? 0);
  }

  return {
    recordChat(provider, model, usage = {}) {
      const input = usage.inputTokens ?? 0;
      const output = usage.outputTokens ?? 0;
      totals.llmCalls++;
      totals.inputTokens += input;
      totals.outputTokens += output;
      addCost(provider, model, input, output);
    },

    recordEmbedding(provider, model, usage = {}) {
      const input = usage.inputTokens ?? 0;
      totals.embeddingCalls++;
      totals.inputTokens += input;
      addCost(provider, model, input, 0);
    },

    // The llm reranker reports no usage: its chat call is recorded by recordChat
    recordRerank(reranker, usage = {}) {
      const input = usage.inputTokens ?? 0;
      const searches = usage.searchUnits ?? 0;
      totals.rerankCalls++;
      totals.inputTokens += input;
      if (input || searches) addCost(reranker, reranker.model, input, 0, searches);
    },

    recordCacheHit() {
      totals.cacheHits++;
    },

    /**
     * snapshot
     * costUSD is null when a model's price is unknown (add it via `pricing`)
     */
    snapshot() {
      return {
        ...totals,
        costUSD: costKnown ? Number(totals.costUSD.toFixed(8)) : null,
        latencyMs: Date.now() - startedAt,
      };
    },
  };
}

module.exports = { createTracker };
