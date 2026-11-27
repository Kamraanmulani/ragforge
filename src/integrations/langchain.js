// ragforge/langchain: use ragforge as a LangChain retriever, and score a LangChain
// retriever with ragforge's eval. Needs @langchain/core (an optional peer dependency).
const { requirePeer, retrieveOptions, checkInstance } = require("./shared");

const ADAPTER = "ragforge/langchain";
let RetrieverClass = null;

// The class extends LangChain's BaseRetriever, so it can only be defined once the package is loaded
function retrieverClass() {
  if (RetrieverClass) return RetrieverClass;
  const { BaseRetriever } = requirePeer("@langchain/core/retrievers", ADAPTER, "@langchain/core");
  const { Document } = requirePeer("@langchain/core/documents", ADAPTER, "@langchain/core");

  RetrieverClass = class RagforgeRetriever extends BaseRetriever {
    static lc_name() {
      return "RagforgeRetriever";
    }

    lc_namespace = ["ragforge", "retrievers"];

    constructor({ rf, options = {}, ...fields } = {}) {
      super(fields);
      this.rf = rf;
      this.retrieveOptions = retrieveOptions(options);
    }

    async _getRelevantDocuments(query) {
      const result = await this.rf.retrieve(query, this.retrieveOptions);
      return result.sources.map(
        (s) =>
          new Document({
            ...(s.id != null && { id: String(s.id) }),
            pageContent: s.content,
            metadata: { ...(s.metadata ?? {}), id: s.id, ref: s.ref, score: s.score, technique: result.route.technique },
          })
      );
    }
  };
  return RetrieverClass;
}

/**
 * createRagforgeRetriever
 * A LangChain retriever backed by ragforge: routing (or a tuned config), query rewriting,
 * hybrid search and reranking, as rf.retrieve() runs them. Use it anywhere LangChain takes
 * a retriever, e.g. createRetrievalChain or `.invoke(query)`.
 * @param {object} rf - From createRagforge(), with a vector store (rf.index() or your own)
 * @param {object} [options]
 * @param {number} [options.topK] - Passages per query (default: the config's, or 5)
 * @param {string} [options.technique] - Always use this technique (e.g. "hybrid") instead of routing
 * @param {object} [options.fields] - Other BaseRetriever fields (tags, metadata, callbacks, verbose)
 * @returns {object} a BaseRetriever
 */
function createRagforgeRetriever(rf, options = {}) {
  checkInstance(rf, ADAPTER);
  const Retriever = retrieverClass();
  return new Retriever({ rf, options, ...(options.fields ?? {}) });
}

/**
 * fromLangChainRetriever
 * Turns a LangChain retriever into a function evaluate() can score next to ragforge's
 * techniques: rf.evaluate({ documents, retrievers: { langchain: fromLangChainRetriever(r) } }).
 * It returns what the retriever returns (its own k), cut to the eval's topK.
 * @param {object} retriever - Anything with invoke(query) -> Document[]
 */
function fromLangChainRetriever(retriever) {
  if (!retriever || typeof retriever.invoke !== "function") throw new Error(`[ragforge] ${ADAPTER}: fromLangChainRetriever needs a LangChain retriever (with invoke)`);
  return async (query, topK) => {
    const docs = (await retriever.invoke(query)) ?? [];
    return docs.slice(0, topK).map((d) => ({ id: d.id ?? d.metadata?.id ?? null, content: d.pageContent, metadata: d.metadata ?? null }));
  };
}

module.exports = { createRagforgeRetriever, fromLangChainRetriever };
