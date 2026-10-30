// In-memory vector store (cosine similarity), so eval needs no database
const { createBM25Index } = require("./bm25");

function norm(v) {
  let sum = 0;
  for (const x of v) sum += x * x;
  return Math.sqrt(sum);
}

/**
 * createMemoryVectorStore
 * Brute-force search; fine for evals and small corpora (thousands of chunks).
 * Also keeps a BM25 keyword index, so it supports hybrid search via searchText().
 */
function createMemoryVectorStore() {
  const items = [];
  const keywords = createBM25Index();

  return {
    /**
     * @param {Array<{id: string, content: string, vector: number[], metadata?: object}>} entries
     */
    add(entries) {
      for (const e of entries) items.push({ ...e, norm: norm(e.vector) });
      keywords.add(entries);
    },

    async query(vector, topK = 5) {
      const qNorm = norm(vector);
      return items
        .map((item) => {
          let dot = 0;
          for (let i = 0; i < vector.length; i++) dot += vector[i] * (item.vector[i] ?? 0);
          const score = qNorm && item.norm ? dot / (qNorm * item.norm) : 0;
          return { id: item.id, content: item.content, score, metadata: item.metadata };
        })
        .sort((a, b) => b.score - a.score)
        .slice(0, topK);
    },

    // Keyword (BM25) search, used for hybrid retrieval
    async searchText(text, topK = 5) {
      return keywords.search(text, topK);
    },

    get size() {
      return items.length;
    },
  };
}

module.exports = { createMemoryVectorStore };
