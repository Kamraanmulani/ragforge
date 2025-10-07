// combines LLM + vector DB in one flow

// src/pipeline/ragPipeline.js
const { translate } = require("./queryTranslator");
const { queryVector } = require("../core/vectorClient");
const { rrf } = require("../techniques/rrf");
const { callLLM } = require("../core/openaiClient");
const { sanitizeText, logInfo } = require("../core/utils");

/**
 * ragPipeline
 * @param {string} query - user query
 * @param {object} options - {
 *    techniques: ['hyde','cot','fanout',...],
 *    topK: number,
 *    rerankK: number,
 *    finalModelOptions: { model, temperature, max_tokens, ... }
 * }
 *
 * Behavior:
 * - Runs queryTranslator to produce subqueries and technique outputs
 * - If a vector DB client is set (queryVector returns results), query it for each subquery
 * - Merge retrieval results using RRF (if multiple result lists)
 * - Use top passages (or HyDE/fanout outputs if no DB) to synthesize final answer via LLM
 */
async function ragPipeline(query, options = {}) {
  const opts = {
    techniques: options.techniques || ["hyde", "cot", "fanout"],
    topK: options.topK || 5,
    rerankK: options.rerankK || 20,
    finalModelOptions: options.finalModelOptions || {},
  };

  logInfo("[ragPipeline] Translating query...");
  const translation = await translate(query, { techniques: opts.techniques });

  // Attempt retrieval for each subQuery (DB optional)
  const retrievalLists = []; // each element: array of results for that subquery
  for (const subQ of translation.subQueries) {
    try {
      // queryVector is intentionally generic: user-provided client should accept either
      // a string query or a pre-computed vector depending on their implementation.
      const list = await queryVector(subQ, opts.topK);
      // Normalize to an array of { id?, score?, answer?, payload? } - depending on user client
      if (Array.isArray(list) && list.length > 0) {
        retrievalLists.push(list);
      }
    } catch (err) {
      logInfo(`[ragPipeline] queryVector failed for "${subQ}": ${err.message || err}`);
      // continue; DB optional
    }
  }

  // If we have DB results, merge them using RRF (or simple concat otherwise)
  let mergedIdsOrDocs = [];
  if (retrievalLists.length > 0) {
    // rrf expects arrays of ranked items. Different providers return different shapes.
    // For robust handling, we map each result list into strings (prefer content fields)
    const rankedListsForRRF = retrievalLists.map((lst) =>
      lst.map((item) => {
        // try to extract a text field
        if (typeof item === "string") return item;
        if (item.answer) return item.answer;
        if (item.payload && item.payload.text) return item.payload.text;
        if (item.payload && item.payload.content) return item.payload.content;
        if (item.payload) return JSON.stringify(item.payload);
        // fallback to id or stringified item
        return item.id ? String(item.id) : JSON.stringify(item);
      })
    );

    // Use RRF to merge and get ranked strings
    const merged = rrf(rankedListsForRRF);
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

  logInfo("[ragPipeline] Synthesizing final answer via LLM...");
  const finalAnswer = await callLLM(synthesisPrompt, opts.finalModelOptions);

  return {
    query,
    translation,
    retrieved: mergedIdsOrDocs,
    answer: sanitizeText(finalAnswer)
  };
}

module.exports = { ragPipeline };
