// `ragforge` command line: currently the `eval` command
const fs = require("fs");
const path = require("path");
const { parseArgs } = require("util");
const { createRagforge } = require("./createRagforge");
const { createOpenAIProvider, createOllamaProvider } = require("./providers");
const { formatTable, renderHtmlReport } = require("./eval/report");
const { DEFAULT_TECHNIQUES } = require("./eval/evaluate");

const TEXT_EXTENSIONS = new Set([".txt", ".md", ".markdown", ".mdx", ".rst"]);

const HELP = `Usage: ragforge eval --docs <file|dir> [options]

Benchmarks RAG query techniques on your documents and recommends one.

Options:
  --docs <path>             File or folder of .txt/.md/.mdx/.rst files (repeatable)
  --questions <n>           Questions to generate from the docs (default 10)
  --questions-file <file>   JSON array of { question, expectedText } to use instead
  --question-styles <list>  Generated mix (default question,keywords,conceptual)
  --techniques <list>       Comma-separated (default ${DEFAULT_TECHNIQUES.join(",")})
                            Available: baseline, hybrid, rerank, hyde, cot, stepback, fanout;
                            combine with + (hybrid adds BM25 keyword search,
                            rerank needs --reranker)
  --reranker <name>         llm, cohere (COHERE_API_KEY) or jina (JINA_API_KEY);
                            adds rerank and hybrid+rerank to the default techniques
  --rerank-candidates <n>   Candidates retrieved before reranking (default 20)
  --provider <name>         openai (default) or ollama
  --embeddings <name>       Embedding provider (default: same as --provider)
  --model <name>            Chat model (default: provider default)
  --embedding-model <name>  Embedding model (default: provider default)
  --top-k <n>               Results per search (default 5)
  --chunk-size <n>          Max characters per chunk (default 800)
  --concurrency <n>         Parallel requests (default 4)
  --html <file>             Write a shareable HTML report
  --json <file>             Write full results as JSON
  -h, --help                Show this help

Examples:
  npx ragforge eval --docs ./docs
  npx ragforge eval --docs ./docs --provider ollama --model qwen2.5 --html report.html
  npx ragforge eval --docs notes.md --techniques baseline,hybrid,hybrid+hyde --questions 30
  npx ragforge eval --docs ./docs --reranker cohere
`;

function collectFiles(target) {
  const stat = fs.statSync(target);
  if (stat.isFile()) return [target];
  return fs
    .readdirSync(target, { withFileTypes: true })
    .filter((e) => !e.name.startsWith(".") && e.name !== "node_modules")
    .flatMap((e) => {
      const full = path.join(target, e.name);
      if (e.isDirectory()) return collectFiles(full);
      return TEXT_EXTENSIONS.has(path.extname(e.name).toLowerCase()) ? [full] : [];
    });
}

/**
 * readDocuments
 * Ids are relative to the --docs argument's parent ("docs/a/b.md" or "notes.md"),
 * so they stay short wherever the command is run from
 */
function readDocuments(docArgs, cwd) {
  return docArgs.flatMap((arg) => {
    const root = path.resolve(cwd, arg);
    const base = path.dirname(root);
    return collectFiles(root).map((file) => ({
      id: path.relative(base, file).split(path.sep).join("/"),
      content: fs.readFileSync(file, "utf8"),
    }));
  });
}

function makeProvider(name, { chatModel, embeddingModel } = {}) {
  const opts = {};
  if (chatModel) opts.chatModel = chatModel;
  if (embeddingModel) opts.embeddingModel = embeddingModel;
  if (name === "openai") return createOpenAIProvider(opts);
  if (name === "ollama") return createOllamaProvider(opts);
  throw new Error(`Unknown provider "${name}" (use openai or ollama)`);
}

function toInt(value, name) {
  if (value === undefined) return undefined;
  const n = Number(value);
  if (!Number.isInteger(n) || n < 1) throw new Error(`--${name} must be a positive whole number`);
  return n;
}

/**
 * main
 * @param {string[]} argv - Arguments after the script name
 * @param {object} io - { stdout, stderr, cwd, createRagforge } (injectable for tests)
 * @returns {Promise<number>} exit code
 */
async function main(argv, io = {}) {
  const stdout = io.stdout ?? process.stdout;
  const stderr = io.stderr ?? process.stderr;
  const cwd = io.cwd ?? process.cwd();
  const factory = io.createRagforge ?? createRagforge;
  const out = (s) => stdout.write(`${s}\n`);

  let parsed;
  try {
    parsed = parseArgs({
      args: argv,
      allowPositionals: true,
      options: {
        docs: { type: "string", multiple: true },
        questions: { type: "string" },
        "questions-file": { type: "string" },
        "question-styles": { type: "string" },
        techniques: { type: "string" },
        provider: { type: "string", default: "openai" },
        embeddings: { type: "string" },
        model: { type: "string" },
        "embedding-model": { type: "string" },
        reranker: { type: "string" },
        "rerank-candidates": { type: "string" },
        "top-k": { type: "string" },
        "chunk-size": { type: "string" },
        concurrency: { type: "string" },
        html: { type: "string" },
        json: { type: "string" },
        help: { type: "boolean", short: "h" },
      },
    });
  } catch (err) {
    stderr.write(`${err.message}\n\n${HELP}`);
    return 1;
  }

  const { values, positionals } = parsed;
  const command = positionals[0];
  if (values.help || !command) {
    out(HELP);
    return values.help ? 0 : 1;
  }
  if (command !== "eval") {
    stderr.write(`Unknown command "${command}".\n\n${HELP}`);
    return 1;
  }

  try {
    if (!values.docs && !values["questions-file"]) throw new Error("--docs is required");

    const documents = readDocuments(values.docs ?? [], cwd);
    if (values.docs && !documents.length) throw new Error("No .txt/.md/.mdx/.rst files found in --docs");

    const questions = values["questions-file"]
      ? JSON.parse(fs.readFileSync(path.resolve(cwd, values["questions-file"]), "utf8"))
      : undefined;

    const embeddingsName = values.embeddings ?? values.provider;
    const rf = factory({
      llm: makeProvider(values.provider, { chatModel: values.model }),
      embeddings: makeProvider(embeddingsName, { embeddingModel: values["embedding-model"] }),
      reranker: values.reranker,
    });

    const techniques = values.techniques ? values.techniques.split(",").map((t) => t.trim()).filter(Boolean) : undefined;

    stderr.write(`Evaluating ${documents.length} document(s) with ${values.provider}...\n`);
    // Live counter in a terminal; one line per phase when piped (CI logs)
    const live = Boolean(stderr.isTTY);
    let lastPhase = null;
    const result = await rf.evaluate({
      documents,
      questions,
      techniques,
      numQuestions: toInt(values.questions, "questions"),
      questionStyles: values["question-styles"] ? values["question-styles"].split(",").map((s) => s.trim()).filter(Boolean) : undefined,
      topK: toInt(values["top-k"], "top-k"),
      rerankCandidates: toInt(values["rerank-candidates"], "rerank-candidates"),
      chunkSize: toInt(values["chunk-size"], "chunk-size"),
      concurrency: toInt(values.concurrency, "concurrency"),
      onProgress: ({ phase, done, total }) => {
        const label = { index: "Indexing chunks", questions: "Generating questions", run: "Running techniques" }[phase];
        if (live) {
          if (phase !== lastPhase && lastPhase !== null) stderr.write("\n");
          stderr.write(`\r${label}: ${done}/${total}`);
        } else if (phase !== lastPhase) {
          stderr.write(`${label} (${total})...\n`);
        }
        lastPhase = phase;
      },
    });
    stderr.write(live ? "\n\n" : "\n");

    out(formatTable(result));

    if (values.json) {
      fs.writeFileSync(path.resolve(cwd, values.json), JSON.stringify(result, null, 2));
      out(`\nJSON written to ${values.json}`);
    }
    if (values.html) {
      fs.writeFileSync(path.resolve(cwd, values.html), renderHtmlReport(result));
      out(`${values.json ? "" : "\n"}HTML report written to ${values.html}`);
    }
    return 0;
  } catch (err) {
    stderr.write(`\nError: ${err.message}\n`);
    return 1;
  }
}

module.exports = { main, HELP };
