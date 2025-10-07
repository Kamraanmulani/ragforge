// Fan-Out Retrieval logic

// src/techniques/fanout.js
const { callLLM, getEmbedding } = require("../core/openaiClient");
const { queryVector } = require("../core/vectorClient");
const { sanitizeText, logInfo } = require("../core/utils");

/**
 * Fan-Out Retrieval
 * Expands a query into multiple sub-questions and retrieves relevant information for each
 * @param {string} query - The original query
 * @returns {Promise<string>} - Combined answer from all sub-queries
 */
async function fanout(query) {
  logInfo("[Fan-Out] Step 1: Expanding query into sub-questions...");
  
  // 1. Expand query into sub-queries
  const prompt = `Generate 3 related sub-questions for: "${query}"\n\nProvide only the questions, one per line.`;
  const subQuestionsRaw = await callLLM(prompt);
  const subQuestions = subQuestionsRaw.split("\n").map(sanitizeText).filter(Boolean).slice(0, 3);
  
  logInfo(`[Fan-Out] Generated ${subQuestions.length} sub-questions`);
  subQuestions.forEach((q, i) => logInfo(`  ${i + 1}. ${q}`));

  const allResults = [];

  // 2. Query vector DB for each sub-question
  logInfo("[Fan-Out] Step 2: Retrieving results for each sub-question...");
  for (const subQ of subQuestions) {
    try {
      // Create embedding for the sub-question
      const vector = await getEmbedding(subQ);
      
      // Query vector DB
      const dbResults = await queryVector(vector, 3);
      
      // Extract content from results
      const contents = dbResults.map(r => {
        if (r.content) return r.content;
        if (r.answer) return r.answer;
        if (typeof r === 'string') return r;
        return JSON.stringify(r).substring(0, 500);
      });
      
      allResults.push(...contents);
      logInfo(`[Fan-Out] Retrieved ${dbResults.length} results for: "${subQ.substring(0, 60)}..."`);
    } catch (err) {
      logInfo(`[Fan-Out] Failed to retrieve results for: "${subQ}" - ${err.message}`);
    }
  }

  logInfo(`[Fan-Out] Step 3: Synthesizing final answer from ${allResults.length} results...`);
  
  // 3. Combine and summarize via LLM
  const combinedContext = allResults.join("\n\n").substring(0, 3000); // Limit context size
  const combinedPrompt = `Based on the following information, provide a comprehensive answer to: "${query}"\n\nInformation:\n${combinedContext}`;
  const summary = await callLLM(combinedPrompt);

  logInfo("[Fan-Out] Complete!");
  return sanitizeText(summary);
}

module.exports = { fanout };
