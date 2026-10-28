// OpenAI provider adapter
const OpenAI = require("openai");
const { getOpenAIKey } = require("../config/env");

/**
 * createOpenAIProvider
 * @param {object} options
 * @param {object} [options.client] - Pre-configured OpenAI client
 * @param {string} [options.apiKey] - Defaults to OPENAI_API_KEY
 * @param {string} [options.baseURL] - Custom endpoint / proxy
 * @param {string} [options.chatModel] - Default chat model
 * @param {string} [options.embeddingModel] - Default embedding model
 */
function createOpenAIProvider(options = {}) {
  const {
    apiKey,
    baseURL,
    chatModel = "gpt-4o-mini",
    // ada-002 kept as default so existing 1536-dim collections keep working
    embeddingModel = "text-embedding-ada-002",
  } = options;

  // Created on first use so a missing key doesn't fail at require time
  let client = options.client ?? null;
  const getClient = () => (client ??= new OpenAI({ apiKey: apiKey ?? getOpenAIKey(), baseURL }));

  return {
    name: "openai",
    chatModel,
    embeddingModel,

    setClient(newClient) {
      client = newClient;
    },

    async chat({ prompt, model, temperature, maxTokens, topP, frequencyPenalty, presencePenalty }) {
      const response = await getClient().chat.completions.create({
        model,
        messages: [{ role: "user", content: prompt }],
        temperature,
        max_tokens: maxTokens,
        top_p: topP,
        frequency_penalty: frequencyPenalty,
        presence_penalty: presencePenalty,
      });
      return {
        text: response.choices[0].message.content ?? "",
        model: response.model ?? model,
        usage: {
          inputTokens: response.usage?.prompt_tokens ?? 0,
          outputTokens: response.usage?.completion_tokens ?? 0,
        },
      };
    },

    async embed({ text, model }) {
      const response = await getClient().embeddings.create({ model, input: text });
      return {
        vector: response.data[0].embedding,
        model: response.model ?? model,
        usage: { inputTokens: response.usage?.prompt_tokens ?? 0 },
      };
    },
  };
}

module.exports = { createOpenAIProvider };
