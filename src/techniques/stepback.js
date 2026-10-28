// Step-Back Prompting
const { sanitizeText } = require("../core/utils");

/**
 * generalQuestion
 * The broader, principle-based version of a specific question
 */
async function generalQuestion(ctx, query, options = {}) {
  const stepBackPrompt = `You are given a specific question. Reformulate it into a more general, abstract, or principle-based question.

Specific Question: "${query}"

Provide only the reformulated general question:`;

  return sanitizeText(await ctx.chat(stepBackPrompt, { temperature: 0.3, max_tokens: 100, ...options }));
}

/**
 * Step-Back Prompting
 * Takes a specific question and reformulates it into a more general, principle-based version
 * This helps retrieve broader conceptual knowledge that can better answer specific questions
 *
 * @param {object} ctx - Call context from createCallContext
 * @param {string} query - The specific query to step back from
 * @param {object} options - LLM options (model, temperature, max_tokens, ...)
 * @returns {Promise<{abstractQuery: string, originalQuery: string, reasoning: string}>}
 */
async function stepback(ctx, query, options = {}) {
  ctx.log(`[Step-Back] Analyzing: "${query}"`);

  // Generate abstract/general version
  const abstractQuery = await generalQuestion(ctx, query, options);

  ctx.log(`[Step-Back] Abstract: "${abstractQuery}"`);

  // Generate reasoning
  const reasoningPrompt = `Explain briefly (1 sentence) why understanding the general concept helps answer the specific question.

Specific: "${query}"
General: "${abstractQuery}"`;

  const reasoning = await ctx.chat(reasoningPrompt, { temperature: 0.3, max_tokens: 80, ...options });

  ctx.log("[Step-Back] Complete!");

  return {
    abstractQuery,
    originalQuery: query,
    reasoning: sanitizeText(reasoning)
  };
}

module.exports = { stepback, generalQuestion };
