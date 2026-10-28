// Indexjs Main file 

// index.js
const { hyde } = require("./src/techniques/hyde");
const { cot } = require("./src/techniques/cot");
const { stepback } = require("./src/techniques/stepback");
const { rrf } = require("./src/techniques/rrf");
const { fanout } = require("./src/techniques/fanout");
const { setVectorClient } = require("./src/core/vectorClient");
const { ragPipeline } = require("./src/pipeline/ragPipeline");
const { callLLM, getEmbedding, setOpenAIClient } = require("./src/core/openaiClient");

module.exports = {
  hyde,
  cot,
  stepback,
  rrf,
  fanout,
  setVectorClient,
  ragPipeline,
  callLLM,
  getEmbedding,
  setOpenAIClient
};
