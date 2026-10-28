// combines LLM + vector DB in one flow
const { translate } = require("./queryTranslator");
const { rrf } = require("../techniques/rrf");
const { sanitizeText, extractText } = require("../core/utils");

/**
 * ragPipeline
 * @param {object} ctx - Call context from createCallContext
 * @param {string} query - user query
 * @param {object} options - {
 *    techniques: ['hyde','cot','fanout',...],
 *    topK: number,
 *    rerankK: number,
 *    techniqueOptions: { model, temperature, max_tokens, ... },
 *    finalModelOptions: { model, temperature, max_tokens, ... }
 * }
 *
 * Behavior:
 * - Runs queryTranslator to produce subqueries and technique outputs
 * - If a vector store is set, embeds each subquery and queries it (in parallel)
 * - Merge retrieval results using RRF (if multiple result lists)
 * - Use top passages (or HyDE/fanout outputs if no DB) to synthesize final answer via LLM
 */
async function ragPipeline(ctx, query, options = {}) {
  const opts = {
    techniques: options.techniques ?? ["hyde", "cot", "fanout"],
    topK: options.topK ?? 5,
    rerankK: options.rerankK ?? 20,
    techniqueOptions: options.techniqueOptions ?? {},
    finalModelOptions: options.finalModelOptions ?? {},
  };

  ctx.log("[ragPipeline] Translating query...");
  const translation = await translate(ctx, query, {
    techniques: opts.techniques,
    techniqueOptions: opts.techniqueOptions,
  });

  // Retrieve for each subQuery in parallel (DB optional)
  const subQueries = ctx.hasVectorStore() ? translation.subQueries : [];
  const lists = await Promise.all(
    subQueries.map(async (subQ) => {
      try {
        // Same contract as hyde/fanout: the vector store always receives an embedding
        const vector = await ctx.embed(subQ);
        return await ctx.queryVectors(vector, opts.topK);
      } catch (err) {
        ctx.log(`[ragPipeline] Retrieval failed for "${subQ}": ${err.message || err}`);
        return [];
      }
    })
  );
  const retrievalLists = lists.filter((list) => Array.isArray(list) && list.length > 0);

  let mergedIdsOrDocs = [];
  if (retrievalLists.length > 0) {
    // Different stores return different shapes; RRF merges on the extracted text
    const merged = rrf(retrievalLists.map((lst) => lst.map(extractText)));
    mergedIdsOrDocs = merged.slice(0, opts.rerankK);
  } else {
    // No DB results — build context from HyDE / Fanout / Cot outputs
    const hv = translation.hyde ? [translation.hyde] : [];
    const fv = translation.fanout ? [translation.fanout] : [];
    const cv = translation.cot && translation.cot.refinedQuery ? [translation.cot.refinedQuery] : [];
    mergedIdsOrDocs = [...hv, ...fv, ...cv].map(sanitizeText).filter(Boolean);
  }

  // Build final synthesis prompt: include top retrieved passages / summaries as context
  const contextText = mergedIdsOrDocs.slice(0, opts.topK).join("\n\n---\n\n");
  const synthesisPrompt = [
    "You are a helpful assistant that synthesizes information to answer a user question.",
    "Use the provided contextual passages below to produce a clear, well-structured answer. If the context is insufficient, answer using general knowledge but label it as such.",
    "",
    "User question:",
    query,
    "",
    "Context passages:",
    contextText || "(no retrieved context available)",
    "",
    "Instructions:",
    "- Provide a concise answer with 3-6 key points.",
    "- If sources or passages are available, reference them inline (e.g., 'Passage 1').",
    "- If the answer requires caution or is uncertain, say so.",
    ""
  ].join("\n");

  ctx.log("[ragPipeline] Synthesizing final answer via LLM...");
  const finalAnswer = await ctx.chat(synthesisPrompt, opts.finalModelOptions);

  return {
    query,
    translation,
    retrieved: mergedIdsOrDocs,
    answer: sanitizeText(finalAnswer)
  };
}

module.exports = { ragPipeline };
