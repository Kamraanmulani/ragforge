// `ragforge label`: mark, in the terminal, which passage answers each real query
// from a trace log. The labels become ground truth for `eval --from-logs`.
const readline = require("readline");
const { createBM25Index } = require("./bm25");
const { queryKey } = require("../core/trace");

/**
 * openingWords
 * The first words of a passage, used as a question's `expectedText`. Matching on
 * them follows the content when chunk ids move (docs edited, chunk size changed).
 */
function openingWords(text, count = 12) {
  return String(text).trim().split(/\s+/).slice(0, count).join(" ");
}

const clip = (text, max) => (text.length > max ? `${text.slice(0, max - 1).trimEnd()}…` : text);

/**
 * labelQueries
 * Asks, for each query, which passage answers it. Candidates come from a keyword
 * search over the chunks, so labelling needs no API key.
 *
 * Answers: a number picks that passage, `n` records that no passage answers the
 * query, `s` skips it, `q` stops. Anything else is searched for, to find a passage
 * the query's own words didn't bring up.
 *
 * @param {object} options
 * @param {Array<{ query: string, count?: number }>} options.queries - Queries to label, in order
 * @param {Array<{ id: string, content: string }>} options.chunks - Passages to choose from
 * @param {number} [options.topK=8] - Candidates shown per search
 * @param {NodeJS.ReadableStream} options.input
 * @param {{ write(text: string): void }} options.output
 * @param {function} [options.onLabel] - Called with each new label, e.g. to save as you go
 * @returns {Promise<{ labels: object[], skipped: number, quit: boolean }>}
 *   A label is { question, expectedText, source, chunkId }, or { question, noAnswer: true }
 */
async function labelQueries({ queries, chunks, topK = 8, input, output, onLabel = () => {} }) {
  const index = createBM25Index();
  index.add(chunks);
  const rl = readline.createInterface({ input, crlfDelay: Infinity });
  const lines = rl[Symbol.asyncIterator]();
  const say = (text = "") => output.write(`${text}\n`);

  const labels = [];
  let skipped = 0;
  let quit = false;

  try {
    for (let i = 0; i < queries.length && !quit; i++) {
      const { query, count = 1 } = queries[i];
      let search = query;
      for (;;) {
        const candidates = index.search(search, topK);
        say();
        say(`[${i + 1}/${queries.length}] ${query}${count > 1 ? `  (asked ${count} times)` : ""}`);
        if (search !== query) say(`Searching for: ${search}`);
        if (!candidates.length) say("  No passage matches these words.");
        candidates.forEach((c, n) => say(`  ${n + 1}. ${c.id}\n     ${clip(c.content, 220)}`));
        output.write("Which passage answers it? number, n = none, s = skip, q = save and quit, or words to search for: ");

        const { value, done } = await lines.next();
        const reply = done ? "q" : value.trim();
        const picked = /^\d+$/.test(reply) ? candidates[Number(reply) - 1] : null;

        if (picked) {
          const label = { question: query, expectedText: openingWords(picked.content), source: picked.content, chunkId: picked.id };
          labels.push(label);
          onLabel(label);
          break;
        }
        if (/^\d+$/.test(reply)) {
          say(`There is no passage ${reply}.`);
        } else if (/^n$/i.test(reply)) {
          const label = { question: query, noAnswer: true };
          labels.push(label);
          onLabel(label);
          break;
        } else if (/^s$/i.test(reply) || reply === "") {
          skipped++;
          break;
        } else if (/^q$/i.test(reply)) {
          quit = true;
          break;
        } else {
          search = reply;
        }
      }
    }
  } finally {
    rl.close();
  }
  return { labels, skipped, quit };
}

/**
 * labelledQuestions
 * Joins a trace log's queries with saved labels, giving eval questions for the
 * queries that have one.
 * @param {Array<{ query: string }>} queries - From uniqueQueries(traces)
 * @param {object[]} labels - Saved by `ragforge label`
 * @returns {{ questions: object[], noAnswer: number, unlabelled: number }}
 */
function labelledQuestions(queries, labels) {
  const byQuery = new Map(labels.map((l) => [queryKey(l.question), l]));
  const questions = [];
  let noAnswer = 0;
  let unlabelled = 0;
  for (const { query } of queries) {
    const label = byQuery.get(queryKey(query));
    if (!label) unlabelled++;
    else if (label.noAnswer) noAnswer++;
    else {
      const { chunkId, ...question } = label;
      questions.push({ ...question, question: query });
    }
  }
  return { questions, noAnswer, unlabelled };
}

module.exports = { labelQueries, labelledQuestions, openingWords };
