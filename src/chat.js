// `ragforge chat`: ask questions about a folder of documents from the terminal
const readline = require("readline");
const { indexDocuments } = require("./indexing/memoryIndex");

const clip = (text, max) => (text.length > max ? `${text.slice(0, max - 1).trimEnd()}…` : text);
const ms = (x) => (x >= 1000 ? `${(x / 1000).toFixed(1)}s` : `${x}ms`);
const usd = (x) => (x === null || x === undefined ? "cost n/a" : x === 0 ? "$0" : x < 0.0001 ? "<$0.0001" : `$${x.toFixed(4)}`);

/**
 * runChat
 * Reads questions line by line and answers each from the indexed documents:
 * the answer streams in, followed by the passages it cites and what the call cost.
 * Each question is answered on its own; earlier turns are not sent to the model.
 *
 * @param {object} options
 * @param {object} options.rf - ragforge instance with a vector store attached
 * @param {number} [options.topK] - Passages per answer (default: the config's, or 5)
 * @param {NodeJS.ReadableStream} options.input
 * @param {{ write(text: string): void }} options.output
 * @returns {Promise<number>} questions answered
 */
async function runChat({ rf, topK, input, output }) {
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
        // A tuned instance (createRagforge({ config })) searches the way its config says;
        // otherwise keyword search is added, since the in-memory index supports it
        const result = await rf.auto(question, { stream: true, ...(topK && { topK }), ...(rf.config ? {} : { hybrid: true }) });
        say();
        for await (const token of result.stream) output.write(token);
        const [citations, stats] = await Promise.all([result.citations, result.stats]);
        say();

        // The passages the answer cites; all of them when it cited none
        const shown = citations.length ? result.sources.filter((s) => citations.includes(s.ref)) : result.sources;
        if (shown.length) {
          say();
          say(citations.length ? "Sources:" : "Sources (none cited):");
          for (const s of shown) say(`  [${s.ref}] ${s.id ?? "passage"}  ${clip(s.content.replace(/\s+/g, " "), 110)}`);
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
