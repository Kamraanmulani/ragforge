// Google Gemini provider adapter (Gemini API via AI Studio keys)
const { requireKey, postJson } = require("./http");

/**
 * createGeminiProvider
 * @param {object} options
 * @param {string} [options.apiKey] - Defaults to GEMINI_API_KEY (or GOOGLE_API_KEY)
 * @param {string} [options.baseURL="https://generativelanguage.googleapis.com/v1beta"]
 * @param {string} [options.chatModel="gemini-2.5-flash"]
 * @param {string} [options.embeddingModel="gemini-embedding-001"]
 */
function createGeminiProvider(options = {}) {
  const {
    apiKey,
    baseURL = "https://generativelanguage.googleapis.com/v1beta",
    chatModel = "gemini-2.5-flash",
    embeddingModel = "gemini-embedding-001",
  } = options;
  const root = baseURL.replace(/\/+$/, "");
  // Keys go in a header, never in the URL
  // GEMINI_API_KEY first; GOOGLE_API_KEY is accepted too
  const headers = () => ({ "x-goog-api-key": requireKey("Gemini", "GEMINI_API_KEY", apiKey ?? process.env.GEMINI_API_KEY ?? process.env.GOOGLE_API_KEY) });
  const modelPath = (model) => `${root}/${model.startsWith("models/") ? model : `models/${model}`}`;

  return {
    name: "gemini",
    chatModel,
    embeddingModel,

    async chat({ prompt, model, temperature, maxTokens, topP }) {
      const data = await postJson("Gemini", `${modelPath(model)}:generateContent`, headers(), {
        contents: [{ role: "user", parts: [{ text: prompt }] }],
        generationConfig: { temperature, maxOutputTokens: maxTokens, topP },
      });
      const parts = data.candidates?.[0]?.content?.parts ?? [];
      return {
        text: parts.map((p) => p.text ?? "").join(""),
        model: data.modelVersion ?? model,
        usage: {
          inputTokens: data.usageMetadata?.promptTokenCount ?? 0,
          outputTokens: data.usageMetadata?.candidatesTokenCount ?? 0,
        },
      };
    },

    async embed({ text, model }) {
      const data = await postJson("Gemini", `${modelPath(model)}:embedContent`, headers(), {
        content: { parts: [{ text }] },
      });
      return {
        vector: data.embedding.values,
        model,
        // The embeddings endpoint reports no token counts
        usage: { inputTokens: 0 },
      };
    },
  };
}

module.exports = { createGeminiProvider };
