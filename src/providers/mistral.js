// Mistral AI provider adapter (La Plateforme). Its chat and embeddings APIs follow the OpenAI shape.
const { requireKey, postJson } = require("./http");

/**
 * createMistralProvider
 * @param {object} options
 * @param {string} [options.apiKey] - Defaults to MISTRAL_API_KEY
 * @param {string} [options.baseURL="https://api.mistral.ai/v1"]
 * @param {string} [options.chatModel="mistral-small-latest"]
 * @param {string} [options.embeddingModel="mistral-embed"]
 */
function createMistralProvider(options = {}) {
  const {
    apiKey,
    baseURL = "https://api.mistral.ai/v1",
    chatModel = "mistral-small-latest",
    embeddingModel = "mistral-embed",
  } = options;
  const root = baseURL.replace(/\/+$/, "");
  const headers = () => ({ Authorization: `Bearer ${requireKey("Mistral", "MISTRAL_API_KEY", apiKey)}` });

  return {
    name: "mistral",
    chatModel,
    embeddingModel,

    async chat({ prompt, model, temperature, maxTokens, topP }) {
      const data = await postJson("Mistral", `${root}/chat/completions`, headers(), {
        model,
        messages: [{ role: "user", content: prompt }],
        temperature,
        max_tokens: maxTokens,
        top_p: topP,
      });
      return {
        text: data.choices?.[0]?.message?.content ?? "",
        model: data.model ?? model,
        usage: {
          inputTokens: data.usage?.prompt_tokens ?? 0,
          outputTokens: data.usage?.completion_tokens ?? 0,
        },
      };
    },

    async embed({ text, model }) {
      const data = await postJson("Mistral", `${root}/embeddings`, headers(), { model, input: [text] });
      return {
        vector: data.data[0].embedding,
        model: data.model ?? model,
        usage: { inputTokens: data.usage?.prompt_tokens ?? 0 },
      };
    },
  };
}

module.exports = { createMistralProvider };
