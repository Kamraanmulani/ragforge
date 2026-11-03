// Qdrant adapter. Pass a QdrantClient from @qdrant/js-client-rest.
const { toResult, requireClient, checkTopK } = require("./shared");

/**
 * createQdrantStore
 * @param {object} options
 * @param {object} options.client - QdrantClient (needs query(collection, params))
 * @param {string} options.collection
 * @param {string} [options.textField="text"] - Payload field holding the passage
 */
function createQdrantStore(options) {
  const { client, collection, textField = "text" } = options;
  requireClient("Qdrant", client, ["query"]);
  if (!collection) throw new Error("[ragforge] Qdrant adapter needs a collection name");

  return {
    async query(vector, topK = 5) {
      const { points } = await client.query(collection, { query: vector, limit: checkTopK(topK), with_payload: true });
      return points.map((p) => {
        const { [textField]: content, ...metadata } = p.payload ?? {};
        return toResult({ id: p.id, content, score: p.score, metadata });
      });
    },
  };
}

module.exports = { createQdrantStore };
