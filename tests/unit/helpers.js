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

// Bag-of-words embedding: texts sharing words get similar vectors,
// so retrieval quality in tests is real, not random
function keywordVector(text, dims = 256) {
  const v = new Array(dims).fill(0);
  for (const word of text.toLowerCase().match(/[a-z]{3,}/g) ?? []) {
    let h = 0;
    for (const ch of word) h = (h * 31 + ch.charCodeAt(0)) >>> 0;
    v[h % dims] += 1;
  }
  return v;
}

/**
 * createKeywordProvider
 * chat replies come from `respond(prompt)`; embeddings use keywordVector
 */
function createKeywordProvider(respond) {
  const calls = { chat: [], embed: [] };
  return {
    name: 'keyword',
    chatModel: 'gpt-4o-mini',
    embeddingModel: 'text-embedding-3-small',
    calls,
    async chat(params) {
      calls.chat.push(params);
      return { text: respond(params.prompt), model: params.model, usage: { inputTokens: 100, outputTokens: 20 } };
    },
    async embed({ text, model }) {
      calls.embed.push(text);
      return { vector: keywordVector(text), model, usage: { inputTokens: 10 } };
    },
  };
}

module.exports = { createFakeProvider, createKeywordProvider, keywordVector };
