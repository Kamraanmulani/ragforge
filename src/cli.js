// `ragforge` command line: the `eval`, `label`, `chat`, `init` and `mcp` commands
const fs = require("fs");
const path = require("path");
const { parseArgs } = require("util");
const { createRagforge } = require("./createRagforge");
const { createBuiltInProvider, builtInProviderNames, supportsEmbeddings } = require("./providers");
const { formatTable, renderHtmlReport } = require("./eval/report");
const { compareEvals, formatComparison, renderMarkdownReport } = require("./eval/compare");
const { DEFAULT_TECHNIQUES } = require("./eval/evaluate");
const { loadDocuments } = require("./loaders");
const { startMcpServer } = require("./mcp/server");
const { chunkDocuments, CHUNK_STRATEGIES } = require("./eval/chunk");
const { labelQueries, labelledQuestions, openingWords } = require("./eval/label");
const { readTraces, uniqueQueries, sample, queryKey } = require("./core/trace");
const { createFileCache } = require("./core/cache");
const { usesContextual } = require("./eval/evaluate");
const { estimateLine, doneLine } = require("./indexing/contextual");

const { runChat, indexDocuments } = require("./chat");
const { init, TEMPLATES } = require("./init");
const { formatTuneTable, renderTuneHtml } = require("./tune/report");
const { loadConfig } = require("./tune/config");
const { DEFAULT_INDEX_DIR, summary: indexSummary } = require("./indexing/persistentIndex");
const { watchSources } = require("./indexing/watch");

const DEFAULT_LABELS_FILE = "ragforge-labels.json";
const DEFAULT_CONTEXT_CACHE = ".ragforge/context-cache.json";
const DEFAULT_CONFIG_FILE = "ragforge.config.json";
const DEFAULT_TUNE_BUDGET = 0.5;

const HELP = `Usage: ragforge eval --docs <file|dir> [options]
       ragforge tune --docs <file|dir> [--budget <usd>] [options]
       ragforge label --from-logs <file> --docs <file|dir> [options]
       ragforge chat --docs <file|dir> [options]
       ragforge init [dir] [--template express|next]
       ragforge mcp --docs <file|dir> [options]
       ragforge index --docs <file|dir> [--index <dir>] [--watch] [options]

eval: benchmarks RAG query techniques on your documents and recommends one.
tune: searches chunking, chunk size, embedding model and technique within a budget,
      and writes the winner to ragforge.config.json for createRagforge({ config }).
label: shows real queries from a trace log and asks which passage answers each one.
       The labels are saved and used by eval --from-logs. Needs no API key.
chat:  answers your questions about the documents in the terminal, with sources.
init:  scaffolds a working RAG app with sample docs, golden questions and a CI eval.
index: builds a saved index of the documents and keeps it up to date: only new and
       edited files are chunked and embedded again, deleted files are removed.
       chat --index and mcp --index use it, so they start without re-embedding.
mcp:  serves your documents to coding agents (Claude Code, Cursor, Windsurf) over MCP.
      Tools: search_docs, get_chunk, ask. Works with no API key (keyword search).

Options:
  --docs <path|url>         File, folder or http(s) URL (repeatable). Reads .txt, .md,
                            .mdx, .rst, .html, .pdf (npm i unpdf), .docx (npm i mammoth)
  --questions <n>           Questions to generate from the docs (default 10)
  --questions-file <file>   JSON array of { question, expectedText } to use instead,
                            or an earlier --json result (reuses its questions)
  --question-styles <list>  Generated mix (default question,keywords,conceptual)
  --techniques <list>       Comma-separated (default ${DEFAULT_TECHNIQUES.join(",")})
                            Available: baseline, hybrid, rerank, contextual, hyde, cot,
                            stepback, fanout;
                            combine with + (hybrid adds BM25 keyword search,
                            rerank needs --reranker)
  --reranker <name>         llm, cohere (COHERE_API_KEY) or jina (JINA_API_KEY);
                            adds rerank and hybrid+rerank to the default techniques
  --rerank-candidates <n>   Candidates retrieved before reranking (default 20)
  --answers                 Also grade answer quality with an LLM judge: faithfulness,
                            answer relevance, context recall and citation accuracy
                            (about 4 more LLM calls per question and technique)
  --judge-model <name>      Chat model that grades the answers (default: same as --model)
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
  --chunk-strategy <name>   How documents are split (default paragraph):
                            paragraph, fixed, sentence, markdown-heading, semantic
                            (splits where the topic shifts; one embedding call per
                            sentence) or code (source files by declaration; also
                            reads code files from --docs folders)
  --chunk-overlap <n>       Characters repeated between chunks, fixed and sentence
                            strategies only (default 0)
  --contextual              Contextual retrieval: an LLM writes a context line for each
                            chunk, which is embedded and keyword-indexed with it.
                            eval: adds contextual and contextual+hybrid to the techniques
                            (or list them in --techniques). One LLM call per chunk,
                            estimated before it starts and cached
  --context-model <name>    Chat model for the context lines (default: --model)
  --context-budget <usd>    Stop before writing context lines that would cost more
  --context-cache <file>    Where context lines are cached between runs
                            (default ${DEFAULT_CONTEXT_CACHE}; "none" to turn off)
  --concurrency <n>         Parallel requests (default 4)
  --html <file>             Write a shareable HTML report
  --from-logs <file>        Evaluate on real queries from a JSONL trace log (written by the
                            onTrace option) instead of generated ones. Uses the queries
                            you labelled with "ragforge label"
  --labels <file>           Labels file for --from-logs and label (default ${DEFAULT_LABELS_FILE})
  --json <file>             Write full results as JSON
  --markdown <file>         Write the scoreboard as Markdown (for PR comments)
  --compare <file>          Earlier --json result to compare against; prints what changed
  --fail-on-drop <points>   With --compare: exit 1 when a technique's hit rate (or its
                            faithfulness, with --answers) fell by more than this many
                            points (0 fails on any drop)
  -h, --help                Show this help

Label options (label command):
  --from-logs <file>        JSONL trace log to take queries from
  --questions <n>           Unlabelled queries to go through in this session (default 10)
  --top-k <n>               Passages shown per query (default 8)
  --labels <file>           Where labels are saved, added to on each run (default ${DEFAULT_LABELS_FILE})

Chat options (chat command):
  --docs, --provider, --embeddings, --model, --embedding-model, --top-k, --chunk-size,
  --chunk-strategy, --chunk-overlap, --contextual, --context-model, --context-budget,
  --context-cache
                            As above. Type a question and press Enter; exit or Ctrl+D to leave.
                            Each question is answered on its own, without earlier turns.

Tune options (tune command):
  --budget <usd|none>       Most the whole run may spend (default $${DEFAULT_TUNE_BUDGET}). The cost
                            is estimated first and every step is checked against it
  --chunk-strategies <list> Strategies to try (default paragraph,markdown-heading,sentence)
  --chunk-sizes <list>      Chunk sizes to try (default 400,800,1200)
  --embedding-models <list> Embedding models to try (default: the provider's, plus
                            text-embedding-3-small with openai)
  --techniques <list>       Techniques tried on the best setups (default hyde, stepback,
                            fanout and their hybrid+ forms; rerank with --reranker,
                            contextual with --contextual). Every setup gets baseline and hybrid
  --top-setups <n>          Setups that get the costlier techniques (default 3)
  --questions <n>           Questions to generate (default 20), or --questions-file
  --out <file>              Where the winning setup is written (default ${DEFAULT_CONFIG_FILE})
  --json, --html            Full results; the HTML has a cost/quality chart
  --docs, --provider, --embeddings, --model, --embedding-model, --reranker, --contextual,
  --context-model, --context-cache, --top-k, --concurrency
                            As for eval

Index options (index command; --index also works with chat and mcp):
  --index <dir>             Where the index is saved (default ${DEFAULT_INDEX_DIR})
  --watch                   Keep running and update the index when a file changes.
                            mcp --watch does the same while serving
  --docs, --provider, --embeddings, --embedding-model, --chunk-strategy, --chunk-size,
  --chunk-overlap, --contextual, --context-model, --context-cache, --config
                            As for eval. Changing chunking, embeddings or contextual
                            rebuilds the index

Config option (chat and mcp):
  --config <file>           Use the setup from ragforge tune: providers, models, chunking,
                            contextual and technique. Flags you pass still win

Init options (init command):
  --template <name>         express (default): server with POST /ask
                            next: Next.js App Router route at /api/ask
  --force                   Overwrite files that already exist

MCP options (mcp command):
  --top-k <n>               Default passages per search_docs / ask call (default 5)
  --chunk-size <n>          Max characters per passage (default 800)
  --chunk-strategy <name>   As for eval; semantic needs --embeddings or --provider
  --contextual              As for eval; needs --provider (and its --context-* options)

Examples:
  npx ragforge mcp --docs ./docs
  npx ragforge mcp --docs ./docs --embeddings ollama --provider ollama --model qwen2.5
  claude mcp add ragforge -- npx -y ragforge mcp --docs ./docs
  npx ragforge eval --docs ./docs
  npx ragforge eval --docs ./docs --provider ollama --model qwen2.5 --html report.html
  npx ragforge eval --docs notes.md --techniques baseline,hybrid,hybrid+hyde --questions 30
  npx ragforge eval --docs ./docs --reranker cohere
  npx ragforge eval --docs ./docs --answers --techniques baseline,hybrid
  npx ragforge eval --docs ./docs --chunk-strategy markdown-heading
  npx ragforge eval --docs ./src --chunk-strategy code --questions 20
  npx ragforge eval --docs ./docs --contextual --context-budget 0.50
  npx ragforge eval --docs handbook.pdf --docs https://example.com/docs/faq
  npx ragforge eval --docs ./docs --questions-file golden.json --compare main.json --fail-on-drop 3
  npx ragforge label --from-logs traces.jsonl --docs ./docs
  npx ragforge chat --docs ./docs
  npx ragforge chat --docs ./docs --provider ollama --model qwen2.5
  npx ragforge init my-rag-app
  npx ragforge init --template next
  npx ragforge tune --docs ./docs --budget 0.50 --html tune.html
  npx ragforge chat --docs ./docs --config ragforge.config.json
  npx ragforge index --docs ./docs --watch
  npx ragforge mcp --docs ./docs --provider openai --index .ragforge/index --watch
  npx ragforge eval --from-logs traces.jsonl --docs ./docs
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

// "a,b" or "a b": on Windows, cmd turns the commas of an npm script's arguments into spaces
function toList(value) {
  return value === undefined ? undefined : value.split(/[\s,]+/).filter(Boolean);
}

// --chunk-overlap: characters, 0 or more
function toCount(value, name) {
  if (value === undefined) return undefined;
  const n = Number(value);
  if (value.trim() === "" || !Number.isInteger(n) || n < 0) throw new Error(`--${name} must be a whole number, 0 or more`);
  return n;
}

/**
 * chunkingFlags
 * --chunk-size, --chunk-strategy and --chunk-overlap, checked before any document is read
 */
function chunkingFlags(values) {
  const strategy = values["chunk-strategy"];
  if (strategy !== undefined && !CHUNK_STRATEGIES.includes(strategy)) {
    throw new Error(`--chunk-strategy must be one of: ${CHUNK_STRATEGIES.join(", ")}`);
  }
  return {
    chunkSize: toInt(values["chunk-size"], "chunk-size"),
    chunkStrategy: strategy,
    chunkOverlap: toCount(values["chunk-overlap"], "chunk-overlap"),
  };
}

/**
 * contextFlags
 * --contextual and its --context-* options. `enabled` says whether this run uses
 * contextual retrieval (for eval, a contextual technique also turns it on).
 * The cache file is only opened when it is used.
 */
function contextFlags(values, { cwd, enabled = values.contextual }) {
  const budget = values["context-budget"];
  let budgetUSD;
  if (budget !== undefined) {
    budgetUSD = Number(budget.replace(/^\$/, ""));
    if (budget.trim() === "" || !Number.isFinite(budgetUSD) || budgetUSD < 0) throw new Error("--context-budget must be an amount in US dollars, e.g. 0.50");
  }
  const used = ["context-model", "context-budget", "context-cache"].filter((f) => values[f] !== undefined);
  if (!enabled && used.length) throw new Error(`--${used[0]} needs --contextual`);
  if (!enabled) return { contextual: false, contextOptions: {} };

  const cacheFile = values["context-cache"] ?? DEFAULT_CONTEXT_CACHE;
  const cache = cacheFile === "none" ? undefined : createFileCache(path.resolve(cwd, cacheFile));
  return {
    contextual: true,
    contextOptions: {
      ...(values["context-model"] && { model: values["context-model"] }),
      ...(budgetUSD !== undefined && { budgetUSD }),
      ...(cache && { cache }),
    },
  };
}

// The code strategy also reads source files from folders
function loadOptions(values, cwd) {
  return { cwd, code: values["chunk-strategy"] === "code" };
}

const NO_DOCUMENTS = "No readable documents found in --docs (.txt, .md, .mdx, .rst, .html, .pdf, .docx; source files with --chunk-strategy code)";

// --fail-on-drop: points of hit rate, 0 or more (decimals allowed)
function toPoints(value) {
  if (value === undefined) return undefined;
  const n = Number(value);
  if (value.trim() === "" || !Number.isFinite(n) || n < 0) throw new Error("--fail-on-drop must be a number of points, 0 or more");
  return n;
}

function readJson(file, flag) {
  let text;
  try {
    text = fs.readFileSync(file, "utf8");
  } catch {
    throw new Error(`${flag}: cannot read ${file}`);
  }
  try {
    return JSON.parse(text);
  } catch (err) {
    throw new Error(`${flag}: ${file} is not valid JSON (${err.message})`);
  }
}

// A JSON array of questions, or an earlier --json result whose questions are reused.
// Generated questions point at a chunk id, and ids move when the docs or the chunk
// size change. They are matched on the opening words of their passage instead, so
// the check follows the content: a passage that moved still counts, one that was
// removed or rewritten doesn't.
function readQuestions(file) {
  const data = readJson(file, "--questions-file");
  if (Array.isArray(data)) return data;
  if (data && Array.isArray(data.questions)) {
    return data.questions.map(({ runs, ...question }) => {
      if (typeof question.source !== "string" || question.expectedText != null) return question;
      const { expectedId, ...rest } = question;
      return { ...rest, expectedText: openingWords(question.source) };
    });
  }
  throw new Error("--questions-file must be a JSON array of questions, or a result written by --json");
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
        answers: { type: "boolean" },
        "judge-model": { type: "string" },
        "top-k": { type: "string" },
        "chunk-size": { type: "string" },
        "chunk-strategy": { type: "string" },
        "chunk-overlap": { type: "string" },
        contextual: { type: "boolean" },
        "context-model": { type: "string" },
        "context-budget": { type: "string" },
        "context-cache": { type: "string" },
        concurrency: { type: "string" },
        html: { type: "string" },
        json: { type: "string" },
        "from-logs": { type: "string" },
        labels: { type: "string" },
        template: { type: "string" },
        force: { type: "boolean" },
        markdown: { type: "string" },
        compare: { type: "string" },
        "fail-on-drop": { type: "string" },
        budget: { type: "string" },
        "chunk-strategies": { type: "string" },
        "chunk-sizes": { type: "string" },
        "embedding-models": { type: "string" },
        "top-setups": { type: "string" },
        out: { type: "string" },
        config: { type: "string" },
        index: { type: "string" },
        watch: { type: "boolean" },
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

  if (command === "chat") return runChatCommand(values, { stdin: io.stdin ?? process.stdin, stdout, stderr, cwd, factory });
  if (command === "init") return runInit(values, positionals[1], { stdout, stderr, cwd });
  if (command === "label") return runLabel(values, { stdin: io.stdin ?? process.stdin, stdout, stderr, cwd });
  if (command === "tune") return runTune(values, { stdout, stderr, cwd, factory });
  if (command === "index") return runIndex(values, { stdout, stderr, cwd, factory, signal: io.signal });

  if (command !== "eval") {
    stderr.write(`Unknown command "${command}".\n\n${HELP}`);
    return 1;
  }

  const provider = values.provider ?? "openai";
  try {
    if (!values.docs && !values["questions-file"]) throw new Error("--docs is required");
    const chunking = chunkingFlags(values);

    const documents = await loadDocuments(values.docs ?? [], loadOptions(values, cwd));
    if (values.docs && !documents.length) throw new Error(NO_DOCUMENTS);

    if (values["from-logs"] && values["questions-file"]) throw new Error("Use --from-logs or --questions-file, not both");
    if (values.labels && !values["from-logs"]) throw new Error("--labels needs --from-logs <file>");
    const questions = values["from-logs"]
      ? readLoggedQuestions(values, { cwd, stderr })
      : values["questions-file"]
        ? readQuestions(path.resolve(cwd, values["questions-file"]))
        : undefined;

    // Read the baseline first, so a bad file fails before any API call is made
    const failOnDrop = toPoints(values["fail-on-drop"]);
    if (failOnDrop !== undefined && !values.compare) throw new Error("--fail-on-drop needs --compare <file>");
    const baseline = values.compare ? readJson(path.resolve(cwd, values.compare), "--compare") : null;
    if (baseline) compareEvals(baseline, baseline);
    if (values["judge-model"] && !values.answers) throw new Error("--judge-model needs --answers");

    const embeddingsName = embeddingsProviderName(values, provider);
    const rf = factory({
      llm: makeProvider(provider, { chatModel: values.model }),
      embeddings: makeProvider(embeddingsName, { embeddingModel: values["embedding-model"] }),
      reranker: values.reranker,
    });

    const techniques = toList(values.techniques);
    const { contextual, contextOptions } = contextFlags(values, { cwd, enabled: values.contextual || Boolean(techniques?.some(usesContextual)) });

    stderr.write(`Evaluating ${documents.length} document(s) with ${provider}...\n`);
    // Live counter in a terminal; one line per phase when piped (CI logs)
    const live = Boolean(stderr.isTTY);
    let lastPhase = null;
    const result = await rf.evaluate({
      documents,
      questions,
      techniques,
      numQuestions: toInt(values.questions, "questions"),
      questionStyles: toList(values["question-styles"]),
      topK: toInt(values["top-k"], "top-k"),
      rerankCandidates: toInt(values["rerank-candidates"], "rerank-candidates"),
      ...chunking,
      concurrency: toInt(values.concurrency, "concurrency"),
      answers: values.answers,
      judgeOptions: values["judge-model"] ? { model: values["judge-model"] } : undefined,
      contextual: values.contextual,
      contextOptions: contextual ? { ...contextOptions, onEstimate: (e) => stderr.write(`${estimateLine(e)}\n`) } : undefined,
      onProgress: ({ phase, done, total }) => {
        const label = {
          index: "Indexing chunks",
          context: "Writing context lines",
          "context-index": "Indexing contextual chunks",
          questions: "Generating questions",
          run: "Running techniques",
          answers: "Writing and grading answers",
        }[phase];
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

    const comparison = baseline ? compareEvals(baseline, result, { failOnDrop }) : null;
    if (comparison) out(`\n${formatComparison(comparison, { baselineName: values.compare })}`);

    if (values.json) {
      fs.writeFileSync(path.resolve(cwd, values.json), JSON.stringify(result, null, 2));
      out(`\nJSON written to ${values.json}`);
    }
    if (values.html) {
      fs.writeFileSync(path.resolve(cwd, values.html), renderHtmlReport(result));
      out(`${values.json ? "" : "\n"}HTML report written to ${values.html}`);
    }
    if (values.markdown) {
      fs.writeFileSync(path.resolve(cwd, values.markdown), renderMarkdownReport(result, { comparison, baselineName: values.compare }));
      out(`${values.json || values.html ? "" : "\n"}Markdown report written to ${values.markdown}`);
    }
    return comparison && !comparison.passed ? 1 : 0;
  } catch (err) {
    stderr.write(`\nError: ${err.message}\n`);
    return 1;
  }
}

// --budget: dollars, or "none" for no limit
function toBudget(value) {
  if (value === undefined) return DEFAULT_TUNE_BUDGET;
  if (value.trim().toLowerCase() === "none") return null;
  const n = Number(value.trim().replace(/^\$/, ""));
  if (value.trim() === "" || !Number.isFinite(n) || n < 0) throw new Error('--budget must be an amount in US dollars, e.g. 0.50, or "none"');
  return n;
}

function toSizes(value) {
  const list = toList(value);
  if (list === undefined) return undefined;
  return list.map((v) => {
    const n = Number(v);
    if (!Number.isInteger(n) || n < 1) throw new Error(`--chunk-sizes must be positive whole numbers, got "${v}"`);
    return n;
  });
}

function costText(x) {
  if (x === null || x === undefined) return "cost unknown";
  return x === 0 ? "$0" : x < 0.0001 ? "<$0.0001" : `$${x.toFixed(4)}`;
}

/**
 * runTune
 * Estimates the search, runs it within the budget, prints the best setups and
 * writes the winner to ragforge.config.json.
 */
async function runTune(values, { stdout, stderr, cwd, factory }) {
  const say = (s = "") => stdout.write(`${s}\n`);
  try {
    if (!values.docs) throw new Error("--docs is required, e.g. npx ragforge tune --docs ./docs");
    if (values["chunk-strategy"] || values["chunk-size"]) throw new Error("tune tries several chunkings: use --chunk-strategies and --chunk-sizes (lists)");
    if (values["from-logs"]) throw new Error("tune takes --questions-file, not --from-logs. Run eval --from-logs --json run.json first and pass run.json");
    const budgetUSD = toBudget(values.budget);
    const strategies = toList(values["chunk-strategies"]);
    strategies?.forEach((s) => {
      if (!CHUNK_STRATEGIES.includes(s)) throw new Error(`--chunk-strategies: "${s}" is not one of ${CHUNK_STRATEGIES.join(", ")}`);
    });
    const sizes = toSizes(values["chunk-sizes"]);
    const topSetups = values["top-setups"] === undefined ? undefined : toCount(values["top-setups"], "top-setups");
    const techniques = toList(values.techniques);
    const { contextual, contextOptions } = contextFlags(values, { cwd, enabled: values.contextual || Boolean(techniques?.some(usesContextual)) });
    const questions = values["questions-file"] ? readQuestions(path.resolve(cwd, values["questions-file"])) : undefined;
    const outFile = values.out ?? DEFAULT_CONFIG_FILE;

    const documents = await loadDocuments(values.docs, { cwd, code: Boolean(strategies?.includes("code")) });
    if (!documents.length) throw new Error(NO_DOCUMENTS);

    const provider = values.provider ?? "openai";
    const rf = factory({
      llm: makeProvider(provider, { chatModel: values.model }),
      embeddings: makeProvider(embeddingsProviderName(values, provider), { embeddingModel: values["embedding-model"] }),
      reranker: values.reranker,
    });

    stderr.write(`Tuning on ${documents.length} document(s) with ${provider}...\n`);
    const live = Boolean(stderr.isTTY);
    let lastStep = null;
    const result = await rf.tune({
      documents,
      questions,
      numQuestions: toInt(values.questions, "questions"),
      chunkStrategies: strategies,
      chunkSizes: sizes,
      embeddingModels: toList(values["embedding-models"]),
      techniques,
      contextual,
      contextOptions,
      topSetups,
      budgetUSD,
      topK: toInt(values["top-k"], "top-k"),
      rerankCandidates: toInt(values["rerank-candidates"], "rerank-candidates"),
      concurrency: toInt(values.concurrency, "concurrency"),
      onPlan: (plan) => {
        const e = plan.estimate;
        const refine = plan.topSetups ? `, then the best ${plan.topSetups} with ${plan.refineTechniques.join(", ")}` : "";
        stderr.write(
          `Plan: ${plan.setups} setups (${plan.chunkStrategies.join(", ")} × ${plan.chunkSizes.join(", ")} chars × ${plan.embeddingModels.join(", ")}) with ${plan.screenTechniques.join(" and ")}${refine}, on ${plan.questions} ${plan.generateQuestions ? "generated " : ""}questions.\n` +
            `Estimated cost: ${costText(e.total)} (questions ${costText(e.questions)}, screening ${costText(e.screening)}, refining ${costText(e.refining)})${plan.budgetUSD === null ? ", no budget" : `, budget $${plan.budgetUSD}`}.\n`
        );
      },
      onProgress: ({ phase, step, steps, setup, done, total }) => {
        const name = phase === "questions" ? "Generating questions" : `${phase === "screen" ? "Screening" : "Refining"} ${step}/${steps} ${setup}`;
        if (live) {
          if (name !== lastStep && lastStep !== null) stderr.write("\n");
          stderr.write(`\r${name}: ${done}/${total}   `);
        } else if (name !== lastStep) {
          stderr.write(`${name}...\n`);
        }
        lastStep = name;
      },
    });
    stderr.write(live ? "\n\n" : "\n");

    say(formatTuneTable(result));
    fs.writeFileSync(path.resolve(cwd, outFile), `${JSON.stringify(result.config, null, 2)}\n`);
    say(`\nConfig written to ${outFile}. Use it with createRagforge({ config: "${outFile}" }), or:`);
    say(`  npx ragforge chat --docs ${values.docs.map((d) => (/\s/.test(d) ? `"${d}"` : d)).join(" --docs ")} --config ${outFile}`);
    if (values.json) {
      fs.writeFileSync(path.resolve(cwd, values.json), JSON.stringify(result, null, 2));
      say(`JSON written to ${values.json}`);
    }
    if (values.html) {
      fs.writeFileSync(path.resolve(cwd, values.html), renderTuneHtml(result));
      say(`HTML report written to ${values.html}`);
    }
    return 0;
  } catch (err) {
    stderr.write(`\nError: ${err.message}\n`);
    return 1;
  }
}

/**
 * runIndex
 * Brings the saved index up to date with the documents. With --watch, keeps doing so
 * whenever a file changes, until Ctrl+C (or `signal` aborts, in tests).
 */
async function runIndex(flags, { stdout, stderr, cwd, factory, signal }) {
  const say = (s = "") => stdout.write(`${s}\n`);
  try {
    if (!flags.docs) throw new Error("--docs is required, e.g. npx ragforge index --docs ./docs");
    const { values, config } = configFlags(flags, cwd);
    const chunking = chunkingFlags(values);
    const context = contextFlags(values, { cwd });
    // Resolved against the project folder (cwd), not wherever the process happens to run
    const dir = path.resolve(cwd, values.index ?? DEFAULT_INDEX_DIR);
    const shownDir = values.index ?? DEFAULT_INDEX_DIR;
    const provider = values.provider ?? "openai";
    if (context.contextual && provider === "local") throw new Error("--contextual needs a chat model to write context lines. Use --provider openai (or ollama, ...) with --embeddings local.");
    const rf = factory({
      llm: makeProvider(provider, { chatModel: values.model }),
      embeddings: makeProvider(embeddingsProviderName(values, provider), { embeddingModel: values["embedding-model"] }),
      ...(config && { config }),
    });

    const live = Boolean(stderr.isTTY);
    async function update() {
      const documents = await loadDocuments(values.docs, loadOptions(values, cwd));
      const started = Date.now();
      const result = await rf.index(documents, {
        ...chunking,
        dir,
        concurrency: toInt(values.concurrency, "concurrency"),
        contextual: context.contextual,
        contextOptions: { ...context.contextOptions, onEstimate: (e) => e.calls && stderr.write(`${estimateLine(e)}\n`) },
        onProgress: ({ phase, done, total }) => live && stderr.write(`\r${phase === "context" ? "Writing context lines" : "Embedding"}: ${done}/${total}   `),
      });
      if (live) stderr.write("\r\x1b[K");
      const cost = result.stats.costUSD;
      const time = new Date().toTimeString().slice(0, 8);
      say(`${values.watch ? `[${time}] ` : ""}${indexSummary(result)} · ${costText(cost)} · ${((Date.now() - started) / 1000).toFixed(1)}s`);
      return { result, documents };
    }

    const first = await update();
    if (!first.documents.length) stderr.write(`Warning: ${NO_DOCUMENTS}\n`);
    if (!values.watch) {
      say(`Index saved to ${shownDir}. Use it with: npx ragforge chat --docs ${values.docs.map((d) => (/\s/.test(d) ? `"${d}"` : d)).join(" --docs ")} --index ${shownDir}`);
      return 0;
    }

    const watcher = watchSources(values.docs, {
      cwd,
      onChange: () => update(),
      onError: (err) => stderr.write(`Error: ${err.message || err}\n`),
    });
    if (watcher.skipped.length) stderr.write(`Not watched (URLs can't be watched): ${watcher.skipped.join(", ")}\n`);
    stderr.write(`Watching ${watcher.watching.length} path(s) for changes. Press Ctrl+C to stop.\n`);
    await new Promise((resolve) => {
      const stop = () => {
        process.off("SIGINT", stop);
        resolve();
      };
      process.once("SIGINT", stop);
      if (signal) signal.aborted ? stop() : signal.addEventListener("abort", stop, { once: true });
    });
    watcher.close();
    return 0;
  } catch (err) {
    stderr.write(`\nError: ${err.message}\n`);
    return 1;
  }
}

/**
 * configFlags
 * --config for chat and mcp: the tuned setup fills in every flag you didn't pass
 */
function configFlags(values, cwd) {
  if (!values.config) return { values, config: null };
  const config = loadConfig(values.config, { cwd });
  const filled = { ...values };
  const fill = (flag, value) => {
    if (filled[flag] === undefined && value !== undefined && value !== null) filled[flag] = value;
  };
  fill("provider", config.llm);
  if (!values.provider || values.provider === config.llm) fill("model", config.chatModel);
  fill("embeddings", config.embeddings);
  if (!values.embeddings || values.embeddings === config.embeddings) fill("embedding-model", config.embeddingModel);
  fill("chunk-strategy", config.chunking.strategy);
  fill("chunk-size", String(config.chunking.size));
  if (config.chunking.overlap) fill("chunk-overlap", String(config.chunking.overlap));
  fill("top-k", String(config.topK));
  if (config.contextual && values.contextual === undefined) filled.contextual = true;
  fill("reranker", config.reranker);
  return { values: filled, config };
}

function readLabels(file) {
  if (!fs.existsSync(file)) return [];
  const data = readJson(file, "--labels");
  if (!Array.isArray(data)) throw new Error(`--labels: ${file} is not a labels file (expected a JSON array)`);
  return data;
}

function readLog(values, cwd) {
  const { traces, skipped } = readTraces(path.resolve(cwd, values["from-logs"]));
  if (!traces.length) throw new Error(`--from-logs: no queries found in ${values["from-logs"]}. Expected JSONL with a "query" on each line, as written by onTrace.`);
  return { queries: uniqueQueries(traces), skipped };
}

// Real queries from the log that have a label, as eval questions
function readLoggedQuestions(values, { cwd, stderr }) {
  let log;
  try {
    log = readLog(values, cwd);
  } catch (err) {
    if (err.code === "ENOENT") throw new Error(`--from-logs: cannot read ${values["from-logs"]}`);
    throw err;
  }
  const labelsFile = values.labels ?? DEFAULT_LABELS_FILE;
  const { questions, noAnswer, unlabelled } = labelledQuestions(log.queries, readLabels(path.resolve(cwd, labelsFile)));
  if (!questions.length) {
    throw new Error(`None of the ${log.queries.length} queries in ${values["from-logs"]} is labelled yet. Run: ragforge label --from-logs ${values["from-logs"]} --docs <path>`);
  }
  const picked = sample(questions, toInt(values.questions, "questions") ?? questions.length);
  const notes = [`${log.queries.length} different queries in the log`];
  if (unlabelled) notes.push(`${unlabelled} not labelled yet`);
  if (noAnswer) notes.push(`${noAnswer} with no answer in the docs`);
  if (log.skipped) notes.push(`${log.skipped} unreadable lines skipped`);
  stderr.write(`Using ${picked.length} labelled real queries from ${values["from-logs"]} (${notes.join(", ")}).\n`);
  return picked;
}

/**
 * runLabel
 * Goes through unlabelled queries from a trace log and saves which passage answers each.
 * Labels are written after every answer, so quitting never loses work.
 */
async function runLabel(values, { stdin, stdout, stderr, cwd }) {
  try {
    if (!values["from-logs"]) throw new Error("--from-logs is required, e.g. npx ragforge label --from-logs traces.jsonl --docs ./docs");
    if (!values.docs) throw new Error("--docs is required: the documents the passages are picked from");
    let log;
    try {
      log = readLog(values, cwd);
    } catch (err) {
      if (err.code === "ENOENT") throw new Error(`--from-logs: cannot read ${values["from-logs"]}`);
      throw err;
    }
    const chunking = chunkingFlags(values);
    // Label shows passages from keyword search and has no embeddings to split by topic
    if (chunking.chunkStrategy === "semantic") throw new Error("label can't use --chunk-strategy semantic, it runs without embeddings. Labels are matched by text, so they work with an eval that uses semantic chunking.");
    const documents = await loadDocuments(values.docs, loadOptions(values, cwd));
    const chunks = await chunkDocuments(documents, { size: chunking.chunkSize, strategy: chunking.chunkStrategy, overlap: chunking.chunkOverlap });
    if (!chunks.length) throw new Error(NO_DOCUMENTS);

    const labelsName = values.labels ?? DEFAULT_LABELS_FILE;
    const labelsFile = path.resolve(cwd, labelsName);
    const labels = readLabels(labelsFile);
    const done = new Set(labels.map((l) => queryKey(l.question)));
    const todo = log.queries.filter((q) => !done.has(queryKey(q.query)));
    if (!todo.length) {
      stdout.write(`All ${log.queries.length} queries in ${values["from-logs"]} are already labelled in ${labelsName}.\n`);
      return 0;
    }
    // Most-asked queries first: they matter most to real users
    todo.sort((a, b) => b.count - a.count);
    const batch = todo.slice(0, toInt(values.questions, "questions") ?? 10);
    stdout.write(`${log.queries.length} different queries in ${values["from-logs"]}, ${todo.length} not labelled yet. Going through ${batch.length}.\n`);

    const result = await labelQueries({
      queries: batch,
      chunks,
      topK: toInt(values["top-k"], "top-k") ?? 8,
      input: stdin,
      output: stdout,
      onLabel: (label) => {
        labels.push(label);
        fs.writeFileSync(labelsFile, `${JSON.stringify(labels, null, 2)}\n`);
      },
    });

    const answered = result.labels.filter((l) => !l.noAnswer).length;
    const none = result.labels.length - answered;
    stdout.write(`\n\nLabelled ${answered}${none ? `, ${none} with no answer in the docs` : ""}${result.skipped ? `, skipped ${result.skipped}` : ""}. `);
    stdout.write(result.labels.length ? `Saved to ${labelsName}.\n` : "Nothing saved.\n");
    if (labels.some((l) => !l.noAnswer)) stdout.write(`Next: npx ragforge eval --from-logs ${values["from-logs"]} --docs ${values.docs.map((d) => (/\s/.test(d) ? `"${d}"` : d)).join(" --docs ")}\n`);
    return 0;
  } catch (err) {
    stderr.write(`Error: ${err.message}\n`);
    return 1;
  }
}

/**
 * runChatCommand
 * Indexes the documents in memory, then answers questions typed in the terminal.
 */
async function runChatCommand(flags, { stdin, stdout, stderr, cwd, factory }) {
  try {
    if (!flags.docs) throw new Error("--docs is required, e.g. npx ragforge chat --docs ./docs");
    const { values, config } = configFlags(flags, cwd);
    const provider = values.provider ?? "openai";
    if (provider === "local") throw new Error("chat needs a chat model, and local has none. Use --provider openai (or ollama, ...) with --embeddings local.");
    const chunking = chunkingFlags(values);
    const context = contextFlags(values, { cwd });
    const documents = await loadDocuments(values.docs, loadOptions(values, cwd));
    if (!documents.length) throw new Error(NO_DOCUMENTS);

    const rf = factory({
      llm: makeProvider(provider, { chatModel: values.model }),
      embeddings: makeProvider(embeddingsProviderName(values, provider), { embeddingModel: values["embedding-model"] }),
      reranker: values.reranker,
      ...(config && { config }),
    });
    if (config) stderr.write(`Using ${values.config}: ${config.technique} on ${values["chunk-strategy"]} chunks of ${values["chunk-size"]} characters${values.contextual ? ", contextual" : ""}.\n`);

    const live = Boolean(stderr.isTTY);
    let lastPhase = null;
    const indexOptions = {
      ...chunking,
      concurrency: toInt(values.concurrency, "concurrency"),
      contextual: context.contextual,
      contextOptions: { ...context.contextOptions, onEstimate: (e) => stderr.write(`${estimateLine(e)}\n`) },
      onProgress: ({ phase, done, total }) => {
        if (!live) return;
        if (phase !== lastPhase && lastPhase !== null) stderr.write("\n");
        lastPhase = phase;
        stderr.write(`\r${phase === "context" ? "Writing context lines" : "Indexing"}: ${done}/${total}`);
      },
    };
    // --index: a saved index that is brought up to date, so unchanged files aren't embedded again
    const indexed = values.index ? await rf.index(documents, { ...indexOptions, dir: path.resolve(cwd, values.index) }) : await indexDocuments(rf, documents, indexOptions);
    const { count, contextual } = indexed;
    const contextNote = contextual ? `, ${doneLine(contextual)}` : "";
    if (values.index) stderr.write(`${live ? "\n" : ""}Index ${values.index}: ${indexSummary(indexed)}\n`);
    stderr.write(`${live && !values.index ? "\n" : ""}Indexed ${count} passages from ${documents.length} document(s) with ${provider}${contextNote}. Ask a question, or type exit.\n\n`);

    await runChat({ rf, topK: toInt(values["top-k"], "top-k"), input: stdin, output: stdout });
    return 0;
  } catch (err) {
    stderr.write(`Error: ${err.message}\n`);
    return 1;
  }
}

/**
 * runInit
 * Writes a template into the folder and prints what to do next.
 */
function runInit(values, target, { stdout, stderr, cwd }) {
  try {
    const template = values.template ?? "express";
    const dir = path.resolve(cwd, target ?? ".");
    const result = init({ dir, template, force: values.force });
    const spec = TEMPLATES[template];
    const say = (text = "") => stdout.write(`${text}\n`);

    say(`ragforge init: ${spec.description}${target ? " in " + target : ""}`);
    say();
    for (const name of result.created) say(`  created  ${name}`);
    for (const name of result.skipped) say(`  kept     ${name}`);
    const { packageJson } = result;
    if (packageJson.created) say("  created  package.json");
    else if (packageJson.added.length) say(`  updated  package.json (added ${packageJson.added.join(", ")})`);
    else say("  kept     package.json");
    if (result.hasDocs) {
      say("\ndocs/ already has files, so the sample document and its golden.json were not written.");
      say('Write golden.json for your docs: [{ "question": "...", "expectedText": "words from the passage that answers it" }]');
    } else if (result.skipped.length && !values.force) {
      say("\nFiles that already existed were kept. Use --force to overwrite them.");
    }

    say("\nNext:");
    if (target) say(`  cd ${/\s/.test(target) ? '"' + target + '"' : target}`);
    for (const step of spec.next) say(`  ${step}`);
    say(`  ${spec.tryIt}`);
    say("\nCheck retrieval quality:");
    say("  npm run eval:baseline   # scores the golden questions and saves ragforge-baseline.json");
    say("  npm run eval            # fails when a score dropped; also runs on pull requests");
    say("  npm run chat            # ask your docs questions in the terminal");
    return 0;
  } catch (err) {
    stderr.write(`Error: ${err.message}\n`);
    return 1;
  }
}

/**
 * runMcp
 * Serves the docs over stdio until the client disconnects. stdout is reserved
 * for protocol messages, so every message goes to stderr.
 */
async function runMcp(flags, { stdin, stdout, stderr, cwd }) {
  try {
    if (!flags.docs) throw new Error("--docs is required, e.g. npx ragforge mcp --docs ./docs");
    const { values, config } = configFlags(flags, cwd);
    const chunking = chunkingFlags(values);
    const context = contextFlags(values, { cwd });
    if (context.contextual && (!values.provider || values.provider === "local")) {
      throw new Error("--contextual needs a chat model to write context lines. Pass --provider, e.g. --provider ollama.");
    }
    const documents = await loadDocuments(values.docs, loadOptions(values, cwd));
    if (!documents.length) throw new Error(NO_DOCUMENTS);

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
      ...chunking,
      ...context,
      ...(config && { config }),
      topK: toInt(values["top-k"], "top-k"),
      concurrency: toInt(values.concurrency, "concurrency"),
      indexDir: values.index ? path.resolve(cwd, values.index) : null,
      // --watch: rebuild (or, with --index, update) the index when a file changes
      watch: values.watch ? { sources: values.docs, cwd, load: () => loadDocuments(values.docs, loadOptions(values, cwd)) } : null,
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
