// Cohere provider adapter (v2 chat and embed APIs)
const { requireKey, postJson } = require("./http");

/**
 * createCohereProvider
 * @param {object} options
 * @param {string} [options.apiKey] - Defaults to COHERE_API_KEY
 * @param {string} [options.baseURL="https://api.cohere.com"]
 * @param {string} [options.chatModel="command-a-03-2025"]
 * @param {string} [options.embeddingModel="embed-v4.0"]
 */
function createCohereProvider(options = {}) {
  const {
    apiKey,
    baseURL = "https://api.cohere.com",
    chatModel = "command-a-03-2025",
    embeddingModel = "embed-v4.0",
  } = options;
  const root = baseURL.replace(/\/+$/, "");
  const headers = () => ({ Authorization: `Bearer ${requireKey("Cohere", "COHERE_API_KEY", apiKey)}` });

  return {
    name: "cohere",
    chatModel,
    embeddingModel,

    async chat({ prompt, model, temperature, maxTokens, topP }) {
      const data = await postJson("Cohere", `${root}/v2/chat`, headers(), {
        model,
        messages: [{ role: "user", content: prompt }],
        temperature,
        max_tokens: maxTokens,
        p: topP,
      });
      const blocks = data.message?.content ?? [];
      const billed = data.usage?.billed_units ?? data.usage?.tokens ?? {};
      return {
        text: blocks.filter((b) => b.type === "text").map((b) => b.text).join(""),
        model,
        usage: {
          inputTokens: billed.input_tokens ?? 0,
          outputTokens: billed.output_tokens ?? 0,
        },
      };
    },

    async embed({ text, model }) {
      const data = await postJson("Cohere", `${root}/v2/embed`, headers(), {
        model,
        texts: [text],
        input_type: "search_document",
        embedding_types: ["float"],
      });
      return {
        vector: data.embeddings.float[0],
        model,
        usage: { inputTokens: data.meta?.billed_units?.input_tokens ?? 0 },
      };
    },
  };
}

module.exports = { createCohereProvider };
