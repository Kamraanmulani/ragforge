// ragforge/llamaindex: use ragforge as a LlamaIndex.TS retriever, and score a LlamaIndex
// retriever with ragforge's eval. Needs @llamaindex/core (an optional peer dependency;
// the `llamaindex` package includes it).
const { requirePeer, retrieveOptions, checkInstance } = require("./shared");

const ADAPTER = "ragforge/llamaindex";
let RetrieverClass = null;

// LlamaIndex queries are a string or message content parts: keep the text
function queryText(query) {
  if (typeof query === "string") return query;
  if (Array.isArray(query)) {
    return query
      .filter((p) => p && p.type === "text")
      .map((p) => p.text)
      .join("\n");
  }
  return String(query ?? "");
}

function retrieverClass() {
  if (RetrieverClass) return RetrieverClass;
  const { BaseRetriever } = requirePeer("@llamaindex/core/retriever", ADAPTER, "@llamaindex/core");
  const { TextNode } = requirePeer("@llamaindex/core/schema", ADAPTER, "@llamaindex/core");

  RetrieverClass = class RagforgeRetriever extends BaseRetriever {
    constructor(rf, options) {
      super();
      this.rf = rf;
      this.retrieveOptions = retrieveOptions(options);
    }

    async _retrieve(bundle) {
      const result = await this.rf.retrieve(queryText(bundle.query), this.retrieveOptions);
      return result.sources.map((s) => ({
        node: new TextNode({
          ...(s.id != null && { id_: String(s.id) }),
          text: s.content,
          metadata: { ...(s.metadata ?? {}), ref: s.ref, technique: result.route.technique },
        }),
        score: s.score ?? undefined,
      }));
    }
  };
  return RetrieverClass;
}

/**
 * createRagforgeRetriever
 * A LlamaIndex retriever backed by ragforge, for query engines and agents:
 *   new RetrieverQueryEngine(createRagforgeRetriever(rf))  or  await retriever.retrieve({ query })
 * @param {object} rf - From createRagforge(), with a vector store
 * @param {object} [options]
 * @param {number} [options.topK]
 * @param {string} [options.technique] - Always use this technique instead of routing
 */
function createRagforgeRetriever(rf, options = {}) {
  checkInstance(rf, ADAPTER);
  const Retriever = retrieverClass();
  return new Retriever(rf, options);
}

/**
 * fromLlamaIndexRetriever
 * Turns a LlamaIndex retriever into a function evaluate() can score next to ragforge's
 * techniques: rf.evaluate({ documents, retrievers: { llamaindex: fromLlamaIndexRetriever(r) } })
 * @param {object} retriever - Anything with retrieve({ query }) -> NodeWithScore[]
 */
function fromLlamaIndexRetriever(retriever) {
  if (!retriever || typeof retriever.retrieve !== "function") throw new Error(`[ragforge] ${ADAPTER}: fromLlamaIndexRetriever needs a LlamaIndex retriever (with retrieve)`);
  return async (query, topK) => {
    const nodes = (await retriever.retrieve({ query })) ?? [];
    return nodes.slice(0, topK).map(({ node, score }) => ({
      id: node.id_ ?? null,
      // MetadataMode.NONE ("NONE"): the text only, as it was indexed
      content: typeof node.getContent === "function" ? node.getContent("NONE") : String(node.text ?? ""),
      score: typeof score === "number" ? score : null,
      metadata: node.metadata ?? null,
    }));
  };
}

module.exports = { createRagforgeRetriever, fromLlamaIndexRetriever, queryText };
