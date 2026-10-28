// Fan-Out Retrieval logic
const { sanitizeText, extractText } = require("../core/utils");

/**
 * Fan-Out Retrieval
 * Expands a query into multiple sub-questions and retrieves relevant information for each
 * @param {object} ctx - Call context from createCallContext
 * @param {string} query - The original query
 * @param {object} options - LLM options (model, temperature, max_tokens, ...)
 * @returns {Promise<string>} - Combined answer from all sub-queries
 */
async function fanout(ctx, query, options = {}) {
  ctx.log("[Fan-Out] Step 1: Expanding query into sub-questions...");

  // 1. Expand query into sub-queries
  const prompt = `Generate 3 related sub-questions for: "${query}"\n\nProvide only the questions, one per line.`;
  const subQuestionsRaw = await ctx.chat(prompt, options);
  const subQuestions = subQuestionsRaw.split("\n").map(sanitizeText).filter(Boolean).slice(0, 3);

  ctx.log(`[Fan-Out] Generated ${subQuestions.length} sub-questions`);

  // 2. Query vector store for each sub-question in parallel (skipped without a store)
  let allResults = [];
  if (ctx.hasVectorStore()) {
    ctx.log("[Fan-Out] Step 2: Retrieving results for each sub-question...");
    const perQuestion = await Promise.all(
      subQuestions.map(async (subQ) => {
        try {
          const vector = await ctx.embed(subQ);
          const dbResults = await ctx.queryVectors(vector, 3);
          return dbResults.map((r) => extractText(r).substring(0, 500));
        } catch (err) {
          ctx.log(`[Fan-Out] Failed to retrieve results for: "${subQ}" - ${err.message}`);
          return [];
        }
      })
    );
    allResults = perQuestion.flat();
  }

  ctx.log(`[Fan-Out] Step 3: Synthesizing final answer from ${allResults.length} results...`);

  // 3. Combine and summarize via LLM
  const combinedContext = allResults.join("\n\n").substring(0, 3000); // Limit context size
  const combinedPrompt = `Based on the following information, provide a comprehensive answer to: "${query}"\n\nInformation:\n${combinedContext}`;
  const summary = await ctx.chat(combinedPrompt, options);

  return sanitizeText(summary);
}

module.exports = { fanout };
