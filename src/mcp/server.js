// MCP server: lets coding agents (Claude Code, Cursor, Windsurf) search a folder of docs.
// Speaks JSON-RPC 2.0 over stdio directly, so the core keeps its 2 dependencies.
// stdout carries protocol messages only; logs go to stderr.
const readline = require("readline");
const pkg = require("../../package.json");
const { chunkDocuments } = require("../eval/chunk");
const { createMemoryVectorStore } = require("../eval/memoryVectorStore");
const { createRagforge } = require("../createRagforge");
const { mapLimit } = require("../core/limit");
const { rrf } = require("../techniques/rrf");

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
async function buildIndex(documents, { chunkSize, embedder, concurrency }) {
  const chunks = chunkDocuments(documents, { size: chunkSize });
  const vectors = embedder
    ? await mapLimit(chunks, concurrency, async (c) => (await embedder.embed({ text: c.content, model: embedder.embeddingModel })).vector)
    : chunks.map(() => []);

  const store = createMemoryVectorStore();
  store.add(chunks.map((c, i) => ({ id: c.id, content: c.content, vector: vectors[i], metadata: { docId: c.docId } })));
  return { chunks, store, byId: new Map(chunks.map((c, i) => [c.id, { ...c, index: i }])), embedder };
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
function createTools(getIndex, getRagforge) {
  return [
    {
      name: "search_docs",
      description: "Search the indexed documents. Returns the most relevant passages with their ids.",
      inputSchema: {
        type: "object",
        properties: {
          query: { type: "string", description: "What to look for: keywords, error codes, names or a question" },
          top_k: { type: "integer", minimum: 1, maximum: MAX_TOP_K, default: DEFAULT_TOP_K, description: "Passages to return" },
        },
        required: ["query"],
      },
      async run({ query, top_k }) {
        if (typeof query !== "string" || !query.trim()) throw new Error("query must be a non-empty string");
        const index = await getIndex();
        const hits = await searchIndex(index, query, topKArg(top_k));
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
          top_k: { type: "integer", minimum: 1, maximum: MAX_TOP_K, default: DEFAULT_TOP_K },
        },
        required: ["question"],
      },
      async run({ question, top_k }) {
        if (typeof question !== "string" || !question.trim()) throw new Error("question must be a non-empty string");
        const topK = topKArg(top_k);
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
 * @param {number} [options.concurrency=4] - Parallel embedding requests
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
    concurrency = 4,
    llm = null,
    stdin = process.stdin,
    stdout = process.stdout,
    stderr = process.stderr,
  } = options;
  // Like the eval: embeddings default to the chat provider, unless it has no embeddings API (anthropic)
  const embedder = options.embedder ?? (llm?.embeddingModel ? llm : null);
  const log = (msg) => stderr.write(`[ragforge mcp] ${msg}\n`);
  const send = (message) => stdout.write(`${JSON.stringify(message)}\n`);

  // Indexing starts right away; tool calls wait for it
  let rf = null;
  const indexing = buildIndex(documents, { chunkSize, embedder, concurrency }).then((index) => {
    if (llm) rf = createRagforge({ llm, embeddings: embedder, vectorStore: index.store, hybrid: true });
    log(`indexed ${index.chunks.length} passages from ${documents.length} document(s)${embedder ? "" : " (keyword search only)"}`);
    return index;
  });
  indexing.catch((err) => log(`indexing failed: ${err.message || err}`));

  const tools = createTools(() => indexing, () => rf);
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
  await Promise.allSettled([...pending]);
}

module.exports = { startMcpServer, buildIndex, searchIndex, topKArg, MAX_TOP_K, DEFAULT_TOP_K };
