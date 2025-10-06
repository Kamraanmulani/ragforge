// Fan-Out Retrieval logic

// src/techniques/fanout.js
const { callLLM } = require("../core/openaiClient");
const { queryVector } = require("../core/vectorClient");
const { sanitizeText } = require("../core/utils");

/**
 * Fan-Out Retrieval
 * @param {string} query
 */
async function fanout(query) {
  // 1. Expand query into sub-queries
  const prompt = `Generate 3 related sub-questions for: "${query}"`;
  const subQuestionsRaw = await callLLM(prompt);
  const subQuestions = subQuestionsRaw.split("\n").map(sanitizeText).filter(Boolean);

  const allResults = [];

  // 2. Query vector DB if available
  for (const subQ of subQuestions) {
    const vector = subQ.split(" ").map((w) => w.length); // dummy embedding
    const dbResults = await queryVector(vector, 5);
    allResults.push(...dbResults.map(r => r.answer || r)); // normalize
  }

  // 3. Combine and summarize via LLM
  const combinedPrompt = `Summarize the following information into a concise answer:\n${allResults.join("\n")}`;
  const summary = await callLLM(combinedPrompt);

  return sanitizeText(summary);
}

module.exports = { fanout };
