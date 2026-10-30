// BM25 keyword index, so hybrid search needs no extra dependency or database

const STOPWORDS = new Set(
  "a an and are as at be by can do does for from has have how i if in is it its of on or so that the this to was what when where which who why will with you your".split(" ")
);

/**
 * tokenize
 * Lowercased words and numbers. Identifiers are kept whole and also split into
 * their parts, so "max_tokens" and "maxTokens" both match "max tokens".
 */
function tokenize(text) {
  const tokens = [];
  for (const word of String(text).match(/[\p{L}\p{N}_]+/gu) ?? []) {
    const parts = word
      .replace(/([a-z\d])([A-Z])/g, "$1 $2")
      .split(/[_\s]+/)
      .filter(Boolean);
    const whole = word.toLowerCase();
    if (!STOPWORDS.has(whole)) tokens.push(whole);
    if (parts.length > 1) {
      for (const p of parts) {
        const lower = p.toLowerCase();
        if (lower !== whole && !STOPWORDS.has(lower)) tokens.push(lower);
      }
    }
  }
  return tokens;
}

/**
 * createBM25Index
 * Okapi BM25 over in-memory documents. Fine for evals and small corpora.
 * @param {object} [options]
 * @param {number} [options.k1=1.2] - Term frequency saturation
 * @param {number} [options.b=0.75] - Length normalization
 */
function createBM25Index({ k1 = 1.2, b = 0.75 } = {}) {
  const docs = [];
  const docFreq = new Map();
  let totalLength = 0;

  return {
    /**
     * @param {Array<{id: string, content: string, metadata?: object}>} entries
     */
    add(entries) {
      for (const e of entries) {
        const terms = new Map();
        const tokens = tokenize(e.content);
        for (const t of tokens) terms.set(t, (terms.get(t) ?? 0) + 1);
        for (const t of terms.keys()) docFreq.set(t, (docFreq.get(t) ?? 0) + 1);
        totalLength += tokens.length;
        docs.push({ id: e.id, content: e.content, metadata: e.metadata, terms, length: tokens.length });
      }
    },

    search(text, topK = 5) {
      const queryTerms = [...new Set(tokenize(text))];
      if (!queryTerms.length || !docs.length) return [];
      const avgLength = totalLength / docs.length || 1;
      const idf = new Map(
        queryTerms.map((t) => {
          const df = docFreq.get(t) ?? 0;
          return [t, Math.log(1 + (docs.length - df + 0.5) / (df + 0.5))];
        })
      );

      const scored = [];
      for (const doc of docs) {
        let score = 0;
        for (const t of queryTerms) {
          const tf = doc.terms.get(t);
          if (!tf) continue;
          score += (idf.get(t) * tf * (k1 + 1)) / (tf + k1 * (1 - b + (b * doc.length) / avgLength));
        }
        if (score > 0) scored.push({ id: doc.id, content: doc.content, score, metadata: doc.metadata });
      }
      return scored.sort((x, y) => y.score - x.score).slice(0, topK);
    },

    get size() {
      return docs.length;
    },
  };
}

module.exports = { createBM25Index, tokenize };
