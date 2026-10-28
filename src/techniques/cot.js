// Chain of Thought prompting
const { sanitizeText } = require("../core/utils");

/**
 * Chain-of-Thought (CoT)
 * @param {object} ctx - Call context from createCallContext
 * @param {string} query
 * @param {object} options - LLM options (model, temperature, max_tokens, ...)
 * @returns {Promise<{reasoning: string, refinedQuery: string}>}
 */
async function cot(ctx, query, options = {}) {
  const prompt = `Think step by step and explain your reasoning for the question: "${query}"`;
  const reasoning = await ctx.chat(prompt, options);

  const refinedQuery = sanitizeText(reasoning);

  return { reasoning: refinedQuery, refinedQuery };
}

module.exports = { cot };
