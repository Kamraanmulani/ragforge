// Anthropic provider adapter (Claude). Chat only: Anthropic has no embeddings API,
// so pair it with another provider for `embeddings`.
const { requireKey, postJson, streamPost, readLines } = require("./http");

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

    // Yields text deltas from the SSE stream; returns { model, usage } at message_stop
    async *chatStream({ prompt, model, temperature, maxTokens }) {
      const res = await streamPost(
        "Anthropic",
        `${root}/messages`,
        { "x-api-key": requireKey("Anthropic", "ANTHROPIC_API_KEY", apiKey), "anthropic-version": "2023-06-01" },
        {
          model,
          max_tokens: maxTokens ?? 1024,
          temperature,
          stream: true,
          messages: [{ role: "user", content: prompt }],
        }
      );
      let usedModel = model;
      let usage = { inputTokens: 0, outputTokens: 0 };
      for await (const line of readLines(res.body)) {
        if (!line.startsWith("data:")) continue;
        const event = JSON.parse(line.slice(5).trim());
        if (event.type === "message_start") {
          usedModel = event.message?.model ?? usedModel;
          usage.inputTokens = event.message?.usage?.input_tokens ?? 0;
        } else if (event.type === "content_block_delta" && event.delta?.type === "text_delta") {
          yield event.delta.text;
        } else if (event.type === "message_delta") {
          usage.outputTokens = event.usage?.output_tokens ?? usage.outputTokens;
        } else if (event.type === "error") {
          throw new Error(`[ragforge] Anthropic stream failed: ${event.error?.message ?? "unknown error"}`);
        }
      }
      return { model: usedModel, usage };
    },

    async embed() {
      throw new Error(
        "[ragforge] Anthropic has no embeddings API. Pass embeddings from another provider, e.g. createRagforge({ llm: 'anthropic', embeddings: 'openai' }) or --embeddings openai."
      );
    },
  };
}

module.exports = { createAnthropicProvider };
