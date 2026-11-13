// Ollama provider adapter (local models, no API cost)
const { streamPost, readLines } = require("./http");

/**
 * createOllamaProvider
 * @param {object} options
 * @param {string} [options.baseURL] - Ollama server (default http://localhost:11434)
 * @param {string} [options.chatModel] - e.g. "llama3.1", "qwen2.5"
 * @param {string} [options.embeddingModel] - e.g. "nomic-embed-text"
 * @param {object} [options.headers] - Extra HTTP headers (auth proxies)
 */
function createOllamaProvider(options = {}) {
  const {
    baseURL = process.env.OLLAMA_HOST || "http://localhost:11434",
    chatModel = "llama3.1",
    embeddingModel = "nomic-embed-text",
    headers = {},
  } = options;

  const root = baseURL.replace(/\/+$/, "");

  async function post(path, body) {
    const res = await fetch(`${root}${path}`, {
      method: "POST",
      headers: { "Content-Type": "application/json", ...headers },
      body: JSON.stringify(body),
    });
    if (!res.ok) {
      throw new Error(`[ragforge] Ollama ${path} failed: ${res.status} ${await res.text()}`);
    }
    return res.json();
  }

  return {
    name: "ollama",
    free: true,
    chatModel,
    embeddingModel,

    async chat({ prompt, model, temperature, maxTokens, topP, frequencyPenalty, presencePenalty }) {
      const data = await post("/api/chat", {
        model,
        messages: [{ role: "user", content: prompt }],
        stream: false,
        options: {
          temperature,
          num_predict: maxTokens,
          top_p: topP,
          frequency_penalty: frequencyPenalty,
          presence_penalty: presencePenalty,
        },
      });
      return {
        text: data.message?.content ?? "",
        model: data.model ?? model,
        usage: {
          inputTokens: data.prompt_eval_count ?? 0,
          outputTokens: data.eval_count ?? 0,
        },
      };
    },

    // Yields tokens from the NDJSON stream; returns { model, usage } from the final line
    async *chatStream({ prompt, model, temperature, maxTokens, topP, frequencyPenalty, presencePenalty }) {
      const res = await streamPost("Ollama", `${root}/api/chat`, headers, {
        model,
        messages: [{ role: "user", content: prompt }],
        stream: true,
        options: {
          temperature,
          num_predict: maxTokens,
          top_p: topP,
          frequency_penalty: frequencyPenalty,
          presence_penalty: presencePenalty,
        },
      });
      let usedModel = model;
      let usage = { inputTokens: 0, outputTokens: 0 };
      for await (const line of readLines(res.body)) {
        if (!line.trim()) continue;
        const data = JSON.parse(line);
        usedModel = data.model ?? usedModel;
        if (data.message?.content) yield data.message.content;
        if (data.done) usage = { inputTokens: data.prompt_eval_count ?? 0, outputTokens: data.eval_count ?? 0 };
      }
      return { model: usedModel, usage };
    },

    async embed({ text, model }) {
      const data = await post("/api/embed", { model, input: text });
      return {
        vector: data.embeddings[0],
        model: data.model ?? model,
        usage: { inputTokens: data.prompt_eval_count ?? 0 },
      };
    },
  };
}

module.exports = { createOllamaProvider };
