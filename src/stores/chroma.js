// Chroma adapter. Pass a collection from the chromadb client (npm install chromadb).
const { toResult, requireClient, checkTopK } = require("./shared");

/**
 * createChromaStore
 * Chroma returns distances. Score is 1 - distance, which is the similarity for cosine collections.
 * Ranking is still correct for other distance metrics.
 * @param {object} options
 * @param {object} options.collection - Chroma collection (needs query({ queryEmbeddings, nResults }))
 */
function createChromaStore(options) {
  const { collection } = options;
  requireClient("Chroma", collection, ["query"]);

  return {
    async query(vector, topK = 5) {
      const res = await collection.query({ queryEmbeddings: [vector], nResults: checkTopK(topK) });
      // Chroma answers per query embedding, and we send one
      const ids = res.ids?.[0] ?? [];
      return ids.map((id, i) => {
        const distance = res.distances?.[0]?.[i];
        return toResult({
          id,
          content: res.documents?.[0]?.[i],
          score: typeof distance === "number" ? 1 - distance : null,
          metadata: res.metadatas?.[0]?.[i],
        });
      });
    },
  };
}

module.exports = { createChromaStore };
