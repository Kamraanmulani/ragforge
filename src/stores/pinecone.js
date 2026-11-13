// Pinecone adapter. Pass an index from @pinecone-database/pinecone.
const { toResult, requireClient, checkTopK } = require("./shared");

/**
 * createPineconeStore
 * @param {object} options
 * @param {object} options.index - Pinecone index (needs query({ vector, topK, includeMetadata }))
 * @param {string} [options.namespace] - Namespace to search, if you use one
 * @param {string} [options.textField="text"] - Metadata field holding the passage
 */
function createPineconeStore(options) {
  const { index, namespace, textField = "text" } = options;
  requireClient("Pinecone", index, ["query"]);
  const target = namespace ? index.namespace(namespace) : index;

  return {
    async query(vector, topK = 5) {
      const res = await target.query({ vector, topK: checkTopK(topK), includeMetadata: true });
      return (res.matches ?? []).map((m) => {
        const { [textField]: content, ...metadata } = m.metadata ?? {};
        return toResult({ id: m.id, content, score: m.score, metadata });
      });
    },
  };
}

module.exports = { createPineconeStore };
