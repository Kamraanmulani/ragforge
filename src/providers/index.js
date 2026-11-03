// Resolves the `llm` / `embeddings` options into provider objects
const { createOpenAIProvider } = require("./openai");
const { createOllamaProvider } = require("./ollama");
const { createAnthropicProvider } = require("./anthropic");
const { createGeminiProvider } = require("./gemini");
const { createMistralProvider } = require("./mistral");
const { createCohereProvider } = require("./cohere");

const builtIn = {
  openai: createOpenAIProvider,
  ollama: createOllamaProvider,
  anthropic: createAnthropicProvider,
  gemini: createGeminiProvider,
  mistral: createMistralProvider,
  cohere: createCohereProvider,
};

// Built-in providers with an embeddings API (anthropic is chat only)
const EMBEDDING_PROVIDERS = new Set(["openai", "ollama", "gemini", "mistral", "cohere"]);

/**
 * createBuiltInProvider
 * @param {string} name - openai, ollama, anthropic, gemini, mistral or cohere
 * @param {object} [options] - Passed to the provider factory (apiKey, chatModel, embeddingModel, baseURL)
 */
function createBuiltInProvider(name, options) {
  const factory = builtIn[name];
  if (!factory) {
    throw new Error(`[ragforge] Unknown provider "${name}". Use one of: ${Object.keys(builtIn).join(", ")}.`);
  }
  return factory(options);
}

/**
 * resolveProvider
 * Accepts a provider name (see builtIn) or a provider object
 * implementing { name, chatModel, embeddingModel, chat(), embed() }
 */
function resolveProvider(provider) {
  if (typeof provider === "string") return createBuiltInProvider(provider);
  if (provider && typeof provider === "object") return provider;
  throw new Error("[ragforge] Provider must be a name or a provider object");
}

module.exports = {
  resolveProvider,
  createBuiltInProvider,
  builtInProviderNames: Object.keys(builtIn),
  supportsEmbeddings: (name) => EMBEDDING_PROVIDERS.has(name),
  createOpenAIProvider,
  createOllamaProvider,
  createAnthropicProvider,
  createGeminiProvider,
  createMistralProvider,
  createCohereProvider,
};
