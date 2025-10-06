// Step-Back Prompting

// src/techniques/stepback.js
const { callLLM } = require("../core/openaiClient");
const { sanitizeText } = require("../core/utils");

/**
 * Step-Back Prompting
 * @param {string} query
 */
async function stepback(query) {
  const prompt = `Reformulate this question into a more general or abstract version: "${query}"`;
  const abstractQuery = await callLLM(prompt);

  return { abstractQuery: sanitizeText(abstractQuery), originalQuery: query };
}

module.exports = { stepback };
