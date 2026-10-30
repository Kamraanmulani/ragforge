// ragforge entry point
//
// v2: create configured instances with createRagforge({ llm, vectorStore, cache, ... }).
// The top-level functions below are the v1 API, kept working through a lazily
// created default instance (OpenAI, key from OPENAI_API_KEY).
const { createRagforge } = require("./src/createRagforge");
const { createOpenAIProvider, createOllamaProvider } = require("./src/providers");
const { createMemoryCache } = require("./src/core/cache");
const { createLLMReranker, createCohereReranker, createJinaReranker } = require("./src/rerankers");
const { DEFAULT_PRICING } = require("./src/core/pricing");
const { rrf } = require("./src/techniques/rrf");
const { createMemoryVectorStore } = require("./src/eval/memoryVectorStore");
const { createBM25Index } = require("./src/eval/bm25");
const { chunkText } = require("./src/eval/chunk");
const { formatTable, renderHtmlReport } = require("./src/eval/report");
const { classifyQuery, DEFAULT_RULES } = require("./src/router/classify");

let defaultInstance = null;
const getDefault = () => (defaultInstance ??= createRagforge());

module.exports = {
  // v2 API
  createRagforge,
  createOpenAIProvider,
  createOllamaProvider,
  createMemoryCache,
  createLLMReranker,
  createCohereReranker,
  createJinaReranker,
  createMemoryVectorStore,
  createBM25Index,
  chunkText,
  formatTable,
  renderHtmlReport,
  classifyQuery,
  DEFAULT_RULES,
  DEFAULT_PRICING,

  // v1 API (default instance)
  hyde: (query, options) => getDefault().hyde(query, options),
  cot: (query, options) => getDefault().cot(query, options),
  stepback: (query, options) => getDefault().stepback(query, options),
  fanout: (query, options) => getDefault().fanout(query, options),
  ragPipeline: (query, options) => getDefault().ragPipeline(query, options),
  auto: (query, options) => getDefault().auto(query, options),
  rrf,
  setVectorClient: (client) => getDefault().setVectorStore(client),
  callLLM: (prompt, options) => getDefault().callLLM(prompt, options),
  // v1 signature was getEmbedding(text, model)
  getEmbedding: (text, modelOrOptions) =>
    getDefault().getEmbedding(text, typeof modelOrOptions === "string" ? { model: modelOrOptions } : modelOrOptions),
  setOpenAIClient: (client) => getDefault().llm.setClient(client),
};
