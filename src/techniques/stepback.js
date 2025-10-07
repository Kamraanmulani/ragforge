// Step-Back Prompting

// src/techniques/stepback.js
const { callLLM } = require("../core/openaiClient");
const { sanitizeText, logInfo } = require("../core/utils");

/**
 * Step-Back Prompting
 * Takes a specific question and reformulates it into a more general, principle-based version
 * This helps retrieve broader conceptual knowledge that can better answer specific questions
 * 
 * @param {string} query - The specific query to step back from
 * @returns {Promise<{abstractQuery: string, originalQuery: string, reasoning: string}>}
 */
async function stepback(query) {
  logInfo(`[Step-Back] Analyzing: "${query}"`);
  
  // Generate abstract/general version
  const stepBackPrompt = `You are given a specific question. Reformulate it into a more general, abstract, or principle-based question.

Specific Question: "${query}"

Provide only the reformulated general question:`;

  const abstractQuery = await callLLM(stepBackPrompt, { temperature: 0.3, max_tokens: 100 });
  
  logInfo(`[Step-Back] Abstract: "${sanitizeText(abstractQuery)}"`);
  
  // Generate reasoning
  const reasoningPrompt = `Explain briefly (1 sentence) why understanding the general concept helps answer the specific question.

Specific: "${query}"
General: "${abstractQuery}"`;

  const reasoning = await callLLM(reasoningPrompt, { temperature: 0.3, max_tokens: 80 });
  
  logInfo("[Step-Back] Complete!");
  
  return { 
    abstractQuery: sanitizeText(abstractQuery), 
    originalQuery: query,
    reasoning: sanitizeText(reasoning)
  };
}

module.exports = { stepback };
