// `ragforge chat`: ask questions about a folder of documents from the terminal
const readline = require("readline");
const { chunkDocuments } = require("./eval/chunk");
const { createMemoryVectorStore } = require("./eval/memoryVectorStore");
const { mapLimit } = require("./core/limit");

const clip = (text, max) => (text.length > max ? `${text.slice(0, max - 1).trimEnd()}…` : text);
const ms = (x) => (x >= 1000 ? `${(x / 1000).toFixed(1)}s` : `${x}ms`);
const usd = (x) => (x === null || x === undefined ? "cost n/a" : x === 0 ? "$0" : x < 0.0001 ? "<$0.0001" : `$${x.toFixed(4)}`);

/**
 * indexDocuments
 * Chunks and embeds the documents into an in-memory store and attaches it to the instance.
 * @returns {Promise<number>} number of passages indexed
 */
async function indexDocuments(rf, documents, { chunkSize = 800, chunkStrategy, chunkOverlap, concurrency = 4, onProgress = () => {} } = {}) {
  const chunks = await chunkDocuments(documents, {
    size: chunkSize,
    strategy: chunkStrategy,
    overlap: chunkOverlap,
    concurrency: concurrency * 2,
    embed: (text) => rf.getEmbedding(text),
  });
  if (!chunks.length) throw new Error("the documents contained no text");
  let done = 0;
  const vectors = await mapLimit(chunks, concurrency * 2, async (c) => {
    const vector = await rf.getEmbedding(c.content);
    onProgress({ done: ++done, total: chunks.length });
    return vector;
  });
  const store = createMemoryVectorStore();
  store.add(chunks.map((c, i) => ({ id: c.id, content: c.content, vector: vectors[i], metadata: { docId: c.docId } })));
  rf.setVectorStore(store);
  return chunks.length;
}

/**
 * runChat
 * Reads questions line by line and answers each from the indexed documents:
 * the answer streams in, followed by the passages it cites and what the call cost.
 * Each question is answered on its own; earlier turns are not sent to the model.
 *
 * @param {object} options
 * @param {object} options.rf - ragforge instance with a vector store attached
 * @param {number} [options.topK=5]
 * @param {NodeJS.ReadableStream} options.input
 * @param {{ write(text: string): void }} options.output
 * @returns {Promise<number>} questions answered
 */
async function runChat({ rf, topK = 5, input, output }) {
  const rl = readline.createInterface({ input, crlfDelay: Infinity });
  const say = (text = "") => output.write(`${text}\n`);
  let answered = 0;

  output.write("> ");
  try {
    for await (const line of rl) {
      const question = line.trim();
      if (/^\/?(exit|quit|q)$/i.test(question)) break;
      if (!question) {
        output.write("> ");
        continue;
      }
      try {
        const result = await rf.auto(question, { stream: true, hybrid: true, topK });
        say();
        for await (const token of result.stream) output.write(token);
        const [citations, stats] = await Promise.all([result.citations, result.stats]);
        say();

        // The passages the answer cites; all of them when it cited none
        const shown = citations.length ? result.sources.filter((s) => citations.includes(s.ref)) : result.sources;
        if (shown.length) {
          say();
          say(citations.length ? "Sources:" : "Sources (none cited):");
          for (const s of shown) say(`  [${s.ref}] ${s.id ?? "passage"}  ${clip(s.content, 110)}`);
        }
        say(`(${result.route.technique} · ${stats.llmCalls} LLM call${stats.llmCalls === 1 ? "" : "s"} · ${usd(stats.costUSD)} · ${ms(stats.latencyMs)})`);
        answered++;
      } catch (err) {
        say(`\nError: ${err.message || err}`);
      }
      output.write("\n> ");
    }
  } finally {
    rl.close();
  }
  say();
  return answered;
}

module.exports = { runChat, indexDocuments };
