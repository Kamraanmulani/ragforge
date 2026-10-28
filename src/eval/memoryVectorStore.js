// In-memory vector store (cosine similarity), so eval needs no database

function norm(v) {
  let sum = 0;
  for (const x of v) sum += x * x;
  return Math.sqrt(sum);
}

/**
 * createMemoryVectorStore
 * Brute-force search; fine for evals and small corpora (thousands of chunks).
 */
function createMemoryVectorStore() {
  const items = [];

  return {
    /**
     * @param {Array<{id: string, content: string, vector: number[], metadata?: object}>} entries
     */
    add(entries) {
      for (const e of entries) items.push({ ...e, norm: norm(e.vector) });
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

    get size() {
      return items.length;
    },
  };
}

module.exports = { createMemoryVectorStore };
