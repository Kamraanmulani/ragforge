// USD prices per 1M tokens (rerankers: per search). Override or extend with createRagforge({ pricing }).
// Prices change; verify against your provider's pricing page.
const DEFAULT_PRICING = {
  "gpt-4": { input: 30, output: 60 },
  "gpt-4-turbo": { input: 10, output: 30 },
  "gpt-4o": { input: 2.5, output: 10 },
  "gpt-4o-mini": { input: 0.15, output: 0.6 },
  "gpt-4.1": { input: 2, output: 8 },
  "gpt-4.1-mini": { input: 0.4, output: 1.6 },
  "gpt-4.1-nano": { input: 0.1, output: 0.4 },
  "gpt-3.5-turbo": { input: 0.5, output: 1.5 },
  "text-embedding-ada-002": { input: 0.1 },
  "text-embedding-3-small": { input: 0.02 },
  "text-embedding-3-large": { input: 0.13 },
  "rerank-v3.5": { perSearch: 0.002 },
  // Anthropic (per MTok, standard tier). Opus 4.6 is the most recently listed Opus price.
  "claude-haiku-4-5": { input: 1, output: 5 },
  "claude-sonnet-4-6": { input: 3, output: 15 },
  "claude-opus-4-6": { input: 5, output: 25 },
  // Gemini. gemini-2.5-pro's long-context (>200k token) tier is not modelled.
  "gemini-2.5-flash-lite": { input: 0.1, output: 0.4 },
  "gemini-2.5-flash": { input: 0.3, output: 2.5 },
  "gemini-2.5-pro": { input: 1.25, output: 10 },
  // Mistral
  "mistral-small-latest": { input: 0.15, output: 0.6 },
  "mistral-large-latest": { input: 0.5, output: 1.5 },
  // Cohere
  "command-a-03-2025": { input: 2.5, output: 10 },
  "embed-v4.0": { input: 0.12 },
};

/**
 * findPrice
 * Exact match first, then longest prefix, so dated snapshots like
 * "gpt-4o-mini-2024-07-18" resolve to "gpt-4o-mini" (not "gpt-4").
 */
function findPrice(pricing, model) {
  if (!model) return null;
  if (pricing[model]) return pricing[model];
  let best = null;
  for (const name of Object.keys(pricing)) {
    if (model.startsWith(name) && (!best || name.length > best.length)) best = name;
  }
  return best ? pricing[best] : null;
}

module.exports = { DEFAULT_PRICING, findPrice };
