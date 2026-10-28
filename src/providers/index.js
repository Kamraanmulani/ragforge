// Resolves the `llm` / `embeddings` options into provider objects
const { createOpenAIProvider } = require("./openai");
const { createOllamaProvider } = require("./ollama");

const builtIn = {
  openai: createOpenAIProvider,
  ollama: createOllamaProvider,
};

/**
 * resolveProvider
 * Accepts a provider name ("openai" | "ollama") or a provider object
 * implementing { name, chatModel, embeddingModel, chat(), embed() }
 */
function resolveProvider(provider) {
  if (typeof provider === "string") {
    const factory = builtIn[provider];
    if (!factory) {
      throw new Error(`[ragforge] Unknown provider "${provider}". Use one of: ${Object.keys(builtIn).join(", ")}, or pass a provider object.`);
    }
    return factory();
  }
  if (provider && typeof provider === "object") return provider;
  throw new Error("[ragforge] Provider must be a name or a provider object");
}

module.exports = { resolveProvider, createOpenAIProvider, createOllamaProvider };
