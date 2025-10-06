// Chain of Thought prompting

// src/techniques/cot.js
const { callLLM } = require("../core/openaiClient");
const { sanitizeText } = require("../core/utils");

/**
 * Chain-of-Thought (CoT)
 * @param {string} query
 */
async function cot(query) {
  const prompt = `Think step by step and explain your reasoning for the question: "${query}"`;
  const reasoning = await callLLM(prompt);

  const refinedQuery = sanitizeText(reasoning);

  return { reasoning: refinedQuery, refinedQuery };
}

module.exports = { cot };
