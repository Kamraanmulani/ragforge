// combines LLM + vector DB in one flow
const { translate } = require("./queryTranslator");
const { rrf } = require("../techniques/rrf");
const { sanitizeText, extractText } = require("../core/utils");

/**
 * citedRefs
 * Passage numbers the answer cites: [1], [2][3], [1, 2] and [1-3] all count.
 * Numbers outside 1..count are ignored.
 */
function citedRefs(answer, count) {
  const refs = new Set();
  for (const [, inside] of String(answer).matchAll(/\[(\d+(?:\s*[,–-]\s*\d+)*)\]/g)) {
    for (const part of inside.split(",")) {
      const [from, to = from] = part.split(/[–-]/).map((n) => Number(n.trim()));
      for (let n = from; n <= Math.min(to, from + 50); n++) if (n >= 1 && n <= count) refs.add(n);
    }
  }
  return [...refs].sort((a, b) => a - b);
}

function toSource(text, item, ref) {
  const obj = item && typeof item === "object" ? item : {};
  return {
    ref,
    id: obj.id ?? obj.payload?.id ?? null,
    content: text,
    score: typeof obj.score === "number" ? obj.score : null,
    metadata: obj.metadata ?? null,
  };
}

/**
 * ragPipeline
 * @param {object} ctx - Call context from createCallContext
 * @param {string} query - user query
 * @param {object} options - {
 *    techniques: ['hyde','cot','fanout',...],
 *    topK: number,
 *    rerankK: number,
 *    hybrid: boolean, // also keyword-search the query (store needs searchText)
 *    rerank: boolean, // retrieve rerankK candidates, then reorder them with the instance reranker
 *    citations: boolean, // ask the LLM to cite passages as [1], [2] (default true)
 *    techniqueOptions: { model, temperature, max_tokens, ... },
 *    finalModelOptions: { model, temperature, max_tokens, ... }
 * }
 *
 * Behavior:
 * - Runs queryTranslator to produce subqueries and technique outputs
 * - If a vector store is set, embeds each subquery and queries it (in parallel)
 * - With hybrid, also runs a keyword (BM25) search for the original query
 * - Merge retrieval results using RRF (if multiple result lists)
 * - With rerank, reorder the merged candidates with the reranker
 * - Use top passages (or HyDE/fanout outputs if no DB) to synthesize final answer via LLM
 * - Return the passages used as numbered `sources`, and which of them the answer cites
 */
async function ragPipeline(ctx, query, options = {}) {
  const opts = {
    techniques: options.techniques ?? ["hyde", "cot", "fanout"],
    topK: options.topK ?? 5,
    rerankK: options.rerankK ?? 20,
    hybrid: options.hybrid ?? false,
    rerank: options.rerank ?? false,
    citations: options.citations ?? true,
    techniqueOptions: options.techniqueOptions ?? {},
    finalModelOptions: options.finalModelOptions ?? {},
  };

  if (opts.hybrid && !ctx.hasTextSearch()) {
    throw new Error("[ragforge] hybrid search needs a vector store with searchText(text, topK), such as createMemoryVectorStore()");
  }
  if (opts.rerank && !ctx.hasReranker()) {
    throw new Error('[ragforge] rerank needs a reranker, e.g. createRagforge({ reranker: "cohere" })');
  }
  // Reranking needs a deeper candidate pool to choose from
  const depth = opts.rerank ? Math.max(opts.rerankK, opts.topK) : opts.topK;

  ctx.log("[ragPipeline] Translating query...");
  const translation = await translate(ctx, query, {
    techniques: opts.techniques,
    techniqueOptions: opts.techniqueOptions,
  });

  // Retrieve for each subQuery in parallel (DB optional)
  const subQueries = ctx.hasVectorStore() ? translation.subQueries : [];
  const searches = subQueries.map(async (subQ) => {
      try {
        // Same contract as hyde/fanout: the vector store always receives an embedding
        const vector = await ctx.embed(subQ);
        return await ctx.queryVectors(vector, depth);
      } catch (err) {
        ctx.log(`[ragPipeline] Retrieval failed for "${subQ}": ${err.message || err}`);
        return [];
      }
    });
  if (opts.hybrid) {
    searches.push(
      ctx.searchText(query, depth).catch((err) => {
        ctx.log(`[ragPipeline] Keyword search failed: ${err.message || err}`);
        return [];
      })
    );
  }
  const lists = await Promise.all(searches);
  const retrievalLists = lists.filter((list) => Array.isArray(list) && list.length > 0);

  let mergedIdsOrDocs = [];
  // First result object seen for each text, so sources keep their id, score and metadata
  const itemsByText = new Map();
  if (retrievalLists.length > 0) {
    // Different stores return different shapes; RRF merges on the extracted text
    const merged = rrf(
      retrievalLists.map((lst) =>
        lst.map((item) => {
          const text = extractText(item);
          if (!itemsByText.has(text)) itemsByText.set(text, item);
          return text;
        })
      )
    );
    mergedIdsOrDocs = merged.slice(0, opts.rerankK);
    if (opts.rerank) {
      try {
        const order = await ctx.rerank(query, mergedIdsOrDocs);
        mergedIdsOrDocs = order.map((i) => mergedIdsOrDocs[i]);
      } catch (err) {
        ctx.log(`[ragPipeline] Rerank failed, keeping retrieval order: ${err.message || err}`);
      }
    }
  } else {
    // No DB results — build context from HyDE / Fanout / Cot outputs
    const hv = translation.hyde ? [translation.hyde] : [];
    const fv = translation.fanout ? [translation.fanout] : [];
    const cv = translation.cot && translation.cot.refinedQuery ? [translation.cot.refinedQuery] : [];
    mergedIdsOrDocs = [...hv, ...fv, ...cv].map(sanitizeText).filter(Boolean);
  }

  // Only retrieved passages are sources; technique outputs aren't evidence to cite
  const top = mergedIdsOrDocs.slice(0, opts.topK);
  const sources = retrievalLists.length > 0 ? top.map((text, i) => toSource(text, itemsByText.get(text), i + 1)) : [];
  const cite = opts.citations && sources.length > 0;

  // Build final synthesis prompt: include top retrieved passages / summaries as context
  const contextText = sources.length
    ? sources.map((s) => `[${s.ref}] ${s.content}`).join("\n\n")
    : top.join("\n\n---\n\n");
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
    ...(cite
      ? [
          "- Cite the passages you use by number in square brackets, like [1] or [2][3], right after the statement they support.",
          "- Only cite passages listed above. Don't cite general knowledge.",
        ]
      : []),
    "- If the answer requires caution or is uncertain, say so.",
    ""
  ].join("\n");

  ctx.log("[ragPipeline] Synthesizing final answer via LLM...");
  const answer = sanitizeText(await ctx.chat(synthesisPrompt, opts.finalModelOptions));
  const citations = cite ? citedRefs(answer, sources.length) : [];
  for (const s of sources) s.cited = citations.includes(s.ref);

  return {
    query,
    translation,
    retrieved: mergedIdsOrDocs,
    sources,
    citations,
    answer,
  };
}

module.exports = { ragPipeline, citedRefs };
