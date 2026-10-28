// Hypothetical Document Embedding
const { extractText } = require("../core/utils");

/**
 * HyDE
 * Generates a hypothetical answer, embeds it and searches the vector store with it.
 * Without a vector store (or with no results) the hypothetical document is returned.
 * @param {object} ctx - Call context from createCallContext
 * @param {string} query
 * @param {object} options - LLM options (model, temperature, max_tokens, ...)
 * @returns {Promise<string>}
 */
async function hyde(ctx, query, options = {}) {
  ctx.log("[HyDE] Step 1: Generating hypothetical document...");
  const hypotheticalDoc = await ctx.chat(`Answer this question in detail: "${query}"`, options);

  // Embedding is only useful if there is somewhere to search
  if (!ctx.hasVectorStore()) {
    ctx.log("[HyDE] No vector store, returning hypothetical document");
    return hypotheticalDoc;
  }

  ctx.log("[HyDE] Step 2: Embedding and searching vector store...");
  const embedding = await ctx.embed(hypotheticalDoc);
  const results = await ctx.queryVectors(embedding, 3);
  ctx.log(`[HyDE] Found ${results.length} results`);

  if (results.length === 0) return hypotheticalDoc;

  ctx.log("[HyDE] Step 3: Generating final answer...");
  const context = results
    .map(extractText)
    .map((text) => text.substring(0, 500))
    .join("\n\n");

  const finalPrompt = `Using this context, answer: "${query}"\n\nContext:\n${context}\n\nAnswer:`;
  return ctx.chat(finalPrompt, { temperature: 0.3, max_tokens: 300, ...options });
}

module.exports = { hyde };
