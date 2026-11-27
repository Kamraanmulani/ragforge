// Builds an in-memory index (vectors + BM25) from documents, for chat, rf.index() and tests
const { chunkDocuments } = require("../eval/chunk");
const { createMemoryVectorStore } = require("../eval/memoryVectorStore");
const { mapLimit } = require("../core/limit");

/**
 * indexDocuments
 * Chunks and embeds the documents into an in-memory store and attaches it to the instance.
 * With `contextual`, each chunk first gets an LLM-written context line, which is
 * embedded and keyword-indexed with it (see rf.contextualize).
 * @param {object} rf - ragforge instance
 * @param {Array} documents
 * @param {object} [options]
 * @param {number} [options.chunkSize=800]
 * @param {string} [options.chunkStrategy="paragraph"]
 * @param {number} [options.chunkOverlap=0]
 * @param {number} [options.concurrency=4]
 * @param {boolean} [options.contextual=false]
 * @param {object} [options.contextOptions]
 * @param {function} [options.onProgress] - ({ phase: "context" | "index", done, total }) => void
 * @returns {Promise<{ count: number, contextual: object|null, store: object }>} passages indexed,
 *   the contextualize() result (estimate, cached, failed, stats) when contextual, and the store
 */
async function indexDocuments(rf, documents, { chunkSize = 800, chunkStrategy, chunkOverlap, concurrency = 4, contextual = false, contextOptions = {}, onProgress = () => {} } = {}) {
  let chunks = await chunkDocuments(documents, {
    size: chunkSize,
    strategy: chunkStrategy,
    overlap: chunkOverlap,
    concurrency: concurrency * 2,
    embed: (text) => rf.getEmbedding(text),
  });
  if (!chunks.length) throw new Error("the documents contained no text");
  let context = null;
  if (contextual) {
    context = await rf.contextualize(chunks, documents, {
      concurrency,
      ...contextOptions,
      onProgress: ({ done, total }) => onProgress({ phase: "context", done, total }),
    });
    chunks = context.chunks;
  }
  let done = 0;
  const vectors = await mapLimit(chunks, concurrency * 2, async (c) => {
    const vector = await rf.getEmbedding(c.indexText ?? c.content);
    onProgress({ phase: "index", done: ++done, total: chunks.length });
    return vector;
  });
  const store = createMemoryVectorStore();
  store.add(chunks.map((c, i) => ({ id: c.id, content: c.content, indexText: c.indexText, vector: vectors[i], metadata: { docId: c.docId } })));
  rf.setVectorStore(store);
  return { count: chunks.length, contextual: context, store };
}

module.exports = { indexDocuments };
