// `ragforge` command line: currently the `eval` command
const fs = require("fs");
const path = require("path");
const { parseArgs } = require("util");
const { createRagforge } = require("./createRagforge");
const { createBuiltInProvider, builtInProviderNames, supportsEmbeddings } = require("./providers");
const { formatTable, renderHtmlReport } = require("./eval/report");
const { DEFAULT_TECHNIQUES } = require("./eval/evaluate");
const { loadDocuments } = require("./loaders");
const { startMcpServer } = require("./mcp/server");

const HELP = `Usage: ragforge eval --docs <file|dir> [options]
       ragforge mcp --docs <file|dir> [options]

eval: benchmarks RAG query techniques on your documents and recommends one.
mcp:  serves your documents to coding agents (Claude Code, Cursor, Windsurf) over MCP.
      Tools: search_docs, get_chunk, ask. Works with no API key (keyword search).

Options:
  --docs <path|url>         File, folder or http(s) URL (repeatable). Reads .txt, .md,
                            .mdx, .rst, .html, .pdf (npm i unpdf), .docx (npm i mammoth)
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
  --provider <name>         openai (eval default), ollama, anthropic, gemini, mistral, cohere
                            or local (embeddings in-process, no key; eval then needs --questions-file)
                            mcp: omit for keyword search only; set it to enable ask
  --embeddings <name>       Embedding provider (default: same as --provider).
                            anthropic has no embeddings, so pass one, e.g. --embeddings openai
                            mcp: omit both for keyword search only (no key, no model)
  --model <name>            Chat model (default: provider default)
  --embedding-model <name>  Embedding model (default: provider default)
  --top-k <n>               Results per search (default 5)
  --chunk-size <n>          Max characters per chunk (default 800)
  --concurrency <n>         Parallel requests (default 4)
  --html <file>             Write a shareable HTML report
  --json <file>             Write full results as JSON
  -h, --help                Show this help

MCP options (mcp command):
  --top-k <n>               Default passages per search_docs / ask call (default 5)
  --chunk-size <n>          Max characters per passage (default 800)

Examples:
  npx ragforge mcp --docs ./docs
  npx ragforge mcp --docs ./docs --embeddings ollama --provider ollama --model qwen2.5
  claude mcp add ragforge -- npx -y ragforge mcp --docs ./docs
  npx ragforge eval --docs ./docs
  npx ragforge eval --docs ./docs --provider ollama --model qwen2.5 --html report.html
  npx ragforge eval --docs notes.md --techniques baseline,hybrid,hybrid+hyde --questions 30
  npx ragforge eval --docs ./docs --reranker cohere
  npx ragforge eval --docs handbook.pdf --docs https://example.com/docs/faq
`;

function makeProvider(name, { chatModel, embeddingModel } = {}) {
  const opts = {};
  if (chatModel) opts.chatModel = chatModel;
  if (embeddingModel) opts.embeddingModel = embeddingModel;
  return createBuiltInProvider(name, opts);
}

// Embeddings come from --embeddings, or from --provider when that provider has an embeddings API
function embeddingsProviderName(values, provider) {
  const name = values.embeddings ?? provider;
  if (name && !supportsEmbeddings(name)) {
    throw new Error(`${name} has no embeddings API. Pass --embeddings with one of: ${builtInProviderNames.filter(supportsEmbeddings).join(", ")}`);
  }
  return name;
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
        provider: { type: "string" },
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
  if (command === "mcp") return runMcp(values, { stdin: io.stdin ?? process.stdin, stdout, stderr, cwd });

  if (command !== "eval") {
    stderr.write(`Unknown command "${command}".\n\n${HELP}`);
    return 1;
  }

  const provider = values.provider ?? "openai";
  try {
    if (!values.docs && !values["questions-file"]) throw new Error("--docs is required");

    const documents = await loadDocuments(values.docs ?? [], { cwd });
    if (values.docs && !documents.length) throw new Error("No readable documents found in --docs (.txt, .md, .mdx, .rst, .html, .pdf, .docx)");

    const questions = values["questions-file"]
      ? JSON.parse(fs.readFileSync(path.resolve(cwd, values["questions-file"]), "utf8"))
      : undefined;

    const embeddingsName = embeddingsProviderName(values, provider);
    const rf = factory({
      llm: makeProvider(provider, { chatModel: values.model }),
      embeddings: makeProvider(embeddingsName, { embeddingModel: values["embedding-model"] }),
      reranker: values.reranker,
    });

    const techniques = values.techniques ? values.techniques.split(",").map((t) => t.trim()).filter(Boolean) : undefined;

    stderr.write(`Evaluating ${documents.length} document(s) with ${provider}...\n`);
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

/**
 * runMcp
 * Serves the docs over stdio until the client disconnects. stdout is reserved
 * for protocol messages, so every message goes to stderr.
 */
async function runMcp(values, { stdin, stdout, stderr, cwd }) {
  try {
    if (!values.docs) throw new Error("--docs is required, e.g. npx ragforge mcp --docs ./docs");
    const documents = await loadDocuments(values.docs, { cwd });
    if (!documents.length) throw new Error("No readable documents found in --docs (.txt, .md, .mdx, .rst, .html, .pdf, .docx)");

    // Keyword search needs no provider. A chat provider enables `ask`; its embeddings
    // enable vector search, unless --embeddings names another provider.
    // local has embeddings only, so it never serves ask
    const llm = values.provider && values.provider !== "local" ? makeProvider(values.provider, { chatModel: values.model }) : null;
    // A chat-only provider (anthropic) leaves search keyword-only unless --embeddings is set
    const provider = values.provider && (values.embeddings || supportsEmbeddings(values.provider)) ? values.provider : undefined;
    const embeddingsName = embeddingsProviderName(values, provider);
    const embedder = embeddingsName ? makeProvider(embeddingsName, { embeddingModel: values["embedding-model"] }) : null;

    await startMcpServer({
      documents,
      llm,
      embedder,
      chunkSize: toInt(values["chunk-size"], "chunk-size"),
      concurrency: toInt(values.concurrency, "concurrency"),
      stdin,
      stdout,
      stderr,
    });
    return 0;
  } catch (err) {
    stderr.write(`Error: ${err.message}\n`);
    return 1;
  }
}

module.exports = { main, HELP };
