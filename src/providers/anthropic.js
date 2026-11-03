// Anthropic provider adapter (Claude). Chat only: Anthropic has no embeddings API,
// so pair it with another provider for `embeddings`.
const { requireKey, postJson } = require("./http");

/**
 * createAnthropicProvider
 * @param {object} options
 * @param {string} [options.apiKey] - Defaults to ANTHROPIC_API_KEY
 * @param {string} [options.baseURL="https://api.anthropic.com/v1"]
 * @param {string} [options.chatModel="claude-sonnet-4-6"]
 */
function createAnthropicProvider(options = {}) {
  const { apiKey, baseURL = "https://api.anthropic.com/v1", chatModel = "claude-sonnet-4-6" } = options;
  const root = baseURL.replace(/\/+$/, "");

  return {
    name: "anthropic",
    chatModel,
    embeddingModel: null,

    async chat({ prompt, model, temperature, maxTokens }) {
      const data = await postJson(
        "Anthropic",
        `${root}/messages`,
        { "x-api-key": requireKey("Anthropic", "ANTHROPIC_API_KEY", apiKey), "anthropic-version": "2023-06-01" },
        {
          model,
          // Anthropic requires max_tokens on every request
          max_tokens: maxTokens ?? 1024,
          temperature,
          messages: [{ role: "user", content: prompt }],
        }
      );
      return {
        text: (data.content ?? []).filter((block) => block.type === "text").map((block) => block.text).join(""),
        model: data.model ?? model,
        usage: {
          inputTokens: data.usage?.input_tokens ?? 0,
          outputTokens: data.usage?.output_tokens ?? 0,
        },
      };
    },

    async embed() {
      throw new Error(
        "[ragforge] Anthropic has no embeddings API. Pass embeddings from another provider, e.g. createRagforge({ llm: 'anthropic', embeddings: 'openai' }) or --embeddings openai."
      );
    },
  };
}

module.exports = { createAnthropicProvider };
