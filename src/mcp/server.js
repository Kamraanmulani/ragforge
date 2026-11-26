// MCP server: lets coding agents (Claude Code, Cursor, Windsurf) search a folder of docs.
// Speaks JSON-RPC 2.0 over stdio directly, so the core keeps its 2 dependencies.
// stdout carries protocol messages only; logs go to stderr.
const readline = require("readline");
const pkg = require("../../package.json");
const { chunkDocuments, checkChunking } = require("../eval/chunk");
const { createMemoryVectorStore } = require("../eval/memoryVectorStore");
const { createRagforge } = require("../createRagforge");
const { mapLimit } = require("../core/limit");
const { rrf } = require("../techniques/rrf");
const { estimateLine, doneLine } = require("../indexing/contextual");
const { syncIndex, embeddingsId, summary: indexSummary } = require("../indexing/persistentIndex");
const { watchSources } = require("../indexing/watch");

const PROTOCOL_VERSIONS = ["2025-06-18", "2025-03-26", "2024-11-05"];
const DEFAULT_TOP_K = 5;
const MAX_TOP_K = 20;

const INSTRUCTIONS =
  "Search the user's documentation. Use search_docs to find passages by keyword or meaning, " +
  "get_chunk to read a passage with its neighbours, and ask for a cited answer when a language model is configured.";

/**
 * topKArg
 * Validates the top_k tool argument (1 to 20, default 5)
 */
function topKArg(value, fallback = DEFAULT_TOP_K) {
  if (value === undefined) return fallback;
  if (!Number.isInteger(value) || value < 1 || value > MAX_TOP_K) {
    throw new Error(`top_k must be a whole number from 1 to ${MAX_TOP_K}`);
  }
  return value;
}

/**
 * buildIndex
 * Chunks the documents and stores them. Every chunk gets a BM25 keyword entry;
 * with an embedder, also a vector. Without one, search is keyword-only and needs no key.
 */
async function buildIndex(documents, { chunkSize, chunkStrategy, chunkOverlap, embedder, concurrency, contextualizer = null, contextOptions = {} }) {
  const embed = embedder && (async (text) => (await embedder.embed({ text, model: embedder.embeddingModel })).vector);
  let chunks = await chunkDocuments(documents, { size: chunkSize, strategy: chunkStrategy, overlap: chunkOverlap, concurrency, embed });
  // Contextual retrieval: search the passage with its context line; agents still read the passage as written
  let context = null;
  if (contextualizer) {
    context = await contextualizer.contextualize(chunks, documents, { concurrency, ...contextOptions });
    chunks = context.chunks;
  }
  const vectors = embed ? await mapLimit(chunks, concurrency, (c) => embed(c.indexText ?? c.content)) : chunks.map(() => []);

  const store = createMemoryVectorStore();
  store.add(chunks.map((c, i) => ({ id: c.id, content: c.content, indexText: c.indexText, vector: vectors[i], metadata: { docId: c.docId } })));
  return { chunks, store, byId: new Map(chunks.map((c, i) => [c.id, { ...c, index: i }])), embedder, context };
}

/**
 * searchIndex
 * Hybrid retrieval: keyword (BM25) and, when available, vector results fused with RRF
 */
async function searchIndex(index, query, topK) {
  const depth = Math.max(topK * 4, 20);
  const lists = [(await index.store.searchText(query, depth)).map((h) => h.id)];
  if (index.embedder) {
    const { vector } = await index.embedder.embed({ text: query, model: index.embedder.embeddingModel });
    lists.push((await index.store.query(vector, depth)).map((h) => h.id));
  }
  return rrf(lists.filter((list) => list.length)).slice(0, topK).map((id) => index.byId.get(id));
}

function formatPassages(chunks) {
  return chunks.map((c, i) => `[${i + 1}] ${c.id}\n${c.content}`).join("\n\n");
}

/**
 * createTools
 * The three tools. Each returns the text shown to the agent.
 */
function createTools(getIndex, getRagforge, defaultTopK = DEFAULT_TOP_K) {
  return [
    {
      name: "search_docs",
      description: "Search the indexed documents. Returns the most relevant passages with their ids.",
      inputSchema: {
        type: "object",
        properties: {
          query: { type: "string", description: "What to look for: keywords, error codes, names or a question" },
          top_k: { type: "integer", minimum: 1, maximum: MAX_TOP_K, default: defaultTopK, description: "Passages to return" },
        },
        required: ["query"],
      },
      async run({ query, top_k }) {
        if (typeof query !== "string" || !query.trim()) throw new Error("query must be a non-empty string");
        const index = await getIndex();
        const hits = await searchIndex(index, query, topKArg(top_k, defaultTopK));
        if (!hits.length) return `No passages match "${query}".`;
        return formatPassages(hits);
      },
    },
    {
      name: "get_chunk",
      description: "Read one passage by id (from search_docs), with the passage before and after it in the same document.",
      inputSchema: {
        type: "object",
        properties: { id: { type: "string", description: "Passage id, such as guide/setup.md#2" } },
        required: ["id"],
      },
      annotations: { readOnlyHint: true },
      async run({ id }) {
        if (typeof id !== "string" || !id) throw new Error("id must be a passage id from search_docs");
        const index = await getIndex();
        const chunk = index.byId.get(id);
        if (!chunk) throw new Error(`No passage with id "${id}". Use search_docs to find ids.`);
        const { chunks } = index;
        const neighbours = [chunks[chunk.index - 1], chunks[chunk.index + 1]].filter((c) => c && c.docId === chunk.docId);
        const context = neighbours.map((c) => `[${c.id}] ${c.content}`);
        return [`${chunk.id}\n${chunk.content}`, ...(context.length ? ["Nearby passages:", ...context] : [])].join("\n\n");
      },
    },
    {
      name: "ask",
      description: "Answer a question from the documents, with numbered source passages. Needs a language model; without one, returns the matching passages.",
      inputSchema: {
        type: "object",
        properties: {
          question: { type: "string", description: "The question to answer" },
          top_k: { type: "integer", minimum: 1, maximum: MAX_TOP_K, default: defaultTopK },
        },
        required: ["question"],
      },
      async run({ question, top_k }) {
        if (typeof question !== "string" || !question.trim()) throw new Error("question must be a non-empty string");
        const topK = topKArg(top_k, defaultTopK);
        const index = await getIndex();
        const rf = getRagforge();
        if (!rf) {
          const hits = await searchIndex(index, question, topK);
          const note = "No language model is configured, so these passages are returned instead of an answer. Start the server with --provider openai or --provider ollama for answers.";
          return hits.length ? `${note}\n\n${formatPassages(hits)}` : `${note}\n\nNo passages match this question.`;
        }
        const result = await rf.auto(question, { topK });
        const sources = result.sources.map((s) => `[${s.ref}] ${s.id}`);
        return [result.answer, ...(sources.length ? ["Sources:", ...sources] : []), `Route: ${result.route.reason}`].join("\n\n");
      },
    },
  ];
}

/**
 * startMcpServer
 * Indexes the documents, then answers MCP requests until stdin closes.
 * @param {object} options
 * @param {Array<{id: string, content: string}>} options.documents - From loadDocuments()
 * @param {number} [options.chunkSize=800]
 * @param {string} [options.chunkStrategy="paragraph"] - See CHUNK_STRATEGIES; semantic needs an embedder
 * @param {number} [options.chunkOverlap=0] - fixed and sentence strategies only
 * @param {number} [options.concurrency=4] - Parallel embedding requests
 * @param {boolean} [options.contextual=false] - Give each passage an LLM-written context line before indexing (needs llm)
 * @param {object} [options.contextOptions] - { model, cache, budgetUSD, maxDocumentChars, onEstimate }, see rf.contextualize
 * @param {number} [options.topK=5] - Passages per search_docs / ask call when the agent doesn't say
 * @param {object} [options.config] - A tuned config (ragforge tune): `ask` uses its technique
 * @param {string} [options.indexDir] - Keep a saved index here and bring it up to date at startup,
 *   so unchanged documents aren't embedded again
 * @param {object} [options.watch] - { sources, cwd, load }: re-read the documents with load() and
 *   update the index when a file in `sources` changes. Searches keep using the old index until
 *   the new one is ready
 * @param {object|null} [options.embedder] - Embedding provider. Null means keyword search only.
 * @param {object|null} [options.llm] - Chat provider for `ask`. Null means no answers.
 * @param {ReadableStream} [options.stdin=process.stdin]
 * @param {WritableStream} [options.stdout=process.stdout]
 * @param {WritableStream} [options.stderr=process.stderr]
 * @returns {Promise<void>} resolves when the client closes stdin
 */
async function startMcpServer(options) {
  const {
    documents,
    chunkSize = 800,
    chunkStrategy = "paragraph",
    chunkOverlap = 0,
    concurrency = 4,
    contextual = false,
    topK = DEFAULT_TOP_K,
    config = null,
    indexDir = null,
    watch = null,
    contextOptions = {},
    llm = null,
    stdin = process.stdin,
    stdout = process.stdout,
    stderr = process.stderr,
  } = options;
  // Like the eval: embeddings default to the chat provider, unless it has no embeddings API (anthropic)
  const embedder = options.embedder ?? (llm?.embeddingModel ? llm : null);
  // Fail before the server starts, not on the first tool call
  checkChunking({ strategy: chunkStrategy, size: chunkSize, overlap: chunkOverlap });
  if (chunkStrategy === "semantic" && !embedder) {
    throw new Error("semantic chunking needs embeddings. Pass --embeddings (e.g. --embeddings local), or pick another --chunk-strategy.");
  }
  if (contextual && !llm) {
    throw new Error("contextual retrieval needs a chat model to write context lines. Pass --provider (e.g. --provider ollama).");
  }
  const log = (msg) => stderr.write(`[ragforge mcp] ${msg}\n`);
  const send = (message) => stdout.write(`${JSON.stringify(message)}\n`);

  // Indexing starts right away; tool calls wait for it. `ask` works once the index is ready.
  let rf = null;
  topKArg(topK);
  const instance = llm ? createRagforge({ llm, embeddings: embedder, hybrid: true, ...(config && { config }) }) : null;
  const contextOpts = {
    ...contextOptions,
    onEstimate: (e) => {
      if (e.calls) log(estimateLine(e));
      contextOptions.onEstimate?.(e);
    },
  };
  const embed = embedder && (async (text) => (await embedder.embed({ text, model: embedder.embeddingModel })).vector);

  // In memory, or (indexDir) a saved index brought up to date: same shape either way
  async function build(docs) {
    if (!indexDir) {
      return buildIndex(docs, { chunkSize, chunkStrategy, chunkOverlap, embedder, concurrency, contextualizer: contextual ? instance : null, contextOptions: contextOpts });
    }
    const synced = await syncIndex({
      documents: docs,
      dir: indexDir,
      chunking: { strategy: chunkStrategy, size: chunkSize, overlap: chunkOverlap },
      embed,
      embeddings: embeddingsId(embedder),
      contextualize: contextual ? (chunks, d) => instance.contextualize(chunks, d, { concurrency, ...contextOpts }) : null,
      contextual: contextual ? contextOptions.model ?? instance.llm.chatModel : null,
      concurrency,
    });
    const chunks = synced.entries;
    return { chunks, store: synced.store, byId: new Map(chunks.map((c, i) => [c.id, { ...c, index: i }])), embedder, context: synced.context, synced };
  }

  function ready(index, docCount) {
    if (instance) {
      instance.setVectorStore(index.store);
      rf = instance;
    }
    const notes = [];
    if (!embedder) notes.push("keyword search only");
    if (index.context && !index.synced) notes.push(doneLine(index.context));
    if (index.synced) notes.push(`${indexDir}: ${indexSummary(index.synced)}`);
    log(`indexed ${index.chunks.length} passages from ${docCount} document(s)${notes.length ? ` (${notes.join("; ")})` : ""}`);
    return index;
  }

  // Tool calls wait for the first index; later updates replace it only once they are ready
  let indexing = build(documents).then((index) => ready(index, documents.length));
  indexing.catch((err) => log(`indexing failed: ${err.message || err}`));

  let watcher = null;
  if (watch) {
    watcher = watchSources(watch.sources, {
      cwd: watch.cwd,
      onChange: async () => {
        const docs = await watch.load();
        const index = ready(await build(docs), docs.length);
        indexing = Promise.resolve(index);
      },
      onError: (err) => log(`update failed, still serving the previous index: ${err.message || err}`),
    });
    log(`watching ${watcher.watching.length} path(s) for changes${watcher.skipped.length ? ` (URLs are not watched: ${watcher.skipped.join(", ")})` : ""}`);
  }

  const tools = createTools(() => indexing, () => rf, topK);
  const toolsByName = new Map(tools.map((t) => [t.name, t]));

  async function dispatch(method, params) {
    if (method === "initialize") {
      const requested = params?.protocolVersion;
      return {
        protocolVersion: PROTOCOL_VERSIONS.includes(requested) ? requested : PROTOCOL_VERSIONS[0],
        capabilities: { tools: { listChanged: false } },
        serverInfo: { name: "ragforge", version: pkg.version },
        instructions: INSTRUCTIONS,
      };
    }
    if (method === "ping") return {};
    if (method === "tools/list") {
      return { tools: tools.map(({ name, description, inputSchema, annotations }) => ({ name, description, inputSchema, ...(annotations && { annotations }) })) };
    }
    if (method === "tools/call") {
      const tool = toolsByName.get(params?.name);
      if (!tool) return { error: { code: -32602, message: `Unknown tool: ${params?.name}` } };
      try {
        const text = await tool.run(params.arguments ?? {});
        return { content: [{ type: "text", text }] };
      } catch (err) {
        // Tool failures are results the agent can read, not protocol errors
        return { content: [{ type: "text", text: `Error: ${err.message || err}` }], isError: true };
      }
    }
    return { error: { code: -32601, message: `Method not found: ${method}` } };
  }

  async function handle(line) {
    let message;
    try {
      message = JSON.parse(line);
    } catch {
      send({ jsonrpc: "2.0", id: null, error: { code: -32700, message: "Parse error" } });
      return;
    }
    // Responses to our requests and notifications (no id) need no reply
    if (!message || typeof message !== "object" || Array.isArray(message) || typeof message.method !== "string") {
      if (message?.id !== undefined && ("result" in message || "error" in message)) return;
      if (message && typeof message === "object" && message.id !== undefined) {
        send({ jsonrpc: "2.0", id: message.id, error: { code: -32600, message: "Invalid Request" } });
      }
      return;
    }
    if (message.id === undefined) return;

    const outcome = await dispatch(message.method, message.params);
    if (outcome?.error) send({ jsonrpc: "2.0", id: message.id, error: outcome.error });
    else send({ jsonrpc: "2.0", id: message.id, result: outcome });
  }

  const pending = new Set();
  const rl = readline.createInterface({ input: stdin, crlfDelay: Infinity });
  rl.on("line", (line) => {
    if (!line.trim()) return;
    const job = handle(line).catch((err) => log(`request failed: ${err.message || err}`));
    pending.add(job);
    job.finally(() => pending.delete(job));
  });

  await new Promise((resolve) => rl.once("close", resolve));
  watcher?.close();
  await Promise.allSettled([...pending]);
}

module.exports = { startMcpServer, buildIndex, searchIndex, topKArg, MAX_TOP_K, DEFAULT_TOP_K };
