// Fake provider for unit tests: no network, records every call

function createFakeProvider({ name = "fake", reply, delayMs = 0, free = false, chatModel = "gpt-4o-mini" } = {}) {
  const calls = { chat: [], embed: [] };
  let inFlight = 0;
  let maxInFlight = 0;

  const wait = () => new Promise((r) => setTimeout(r, delayMs));

  return {
    name,
    free,
    chatModel,
    embeddingModel: "text-embedding-3-small",
    calls,
    get maxInFlight() {
      return maxInFlight;
    },

    async chat(params) {
      calls.chat.push(params);
      inFlight++;
      maxInFlight = Math.max(maxInFlight, inFlight);
      await wait();
      inFlight--;
      const text = typeof reply === "function" ? reply(params) : reply ?? "Q1?\nQ2?\nQ3?";
      return { text, model: params.model, usage: { inputTokens: 1000, outputTokens: 500 } };
    },

    async embed(params) {
      calls.embed.push(params);
      await wait();
      return { vector: [0.1, 0.2, 0.3], model: params.model, usage: { inputTokens: 100 } };
    },
  };
}

module.exports = { createFakeProvider };
