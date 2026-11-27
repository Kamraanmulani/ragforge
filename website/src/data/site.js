const GITHUB = "https://github.com/Kamraanmulani/ragforge";

export const LINKS = {
  github: GITHUB,
  npm: "https://www.npmjs.com/package/ragforge",
  issues: `${GITHUB}/issues`,
  license: `${GITHUB}/blob/main/LICENSE`,
  blob: `${GITHUB}/blob/main/`,
};

// The run shown in the README: 12 npm package READMEs, 30 questions, gpt-4o-mini
export const SCOREBOARD = [
  { technique: "baseline", hit: "77%", mrr: "0.672", latency: "407ms", cost: "$0.000001", recommended: true },
  { technique: "stepback", hit: "77%", mrr: "0.569", latency: "2.1s", cost: "$0.000021" },
  { technique: "fanout", hit: "77%", mrr: "0.555", latency: "2.2s", cost: "$0.000049" },
  { technique: "hyde+stepback", hit: "77%", mrr: "0.539", latency: "6.6s", cost: "$0.000374" },
  { technique: "hyde", hit: "67%", mrr: "0.528", latency: "6.7s", cost: "$0.000352" },
];

export const SAMPLE_QUERIES = [
  "PostgreSQL vs MySQL for analytics",
  "What does error E404 mean?",
  "refund policy",
  "Why does a higher learning rate make the loss diverge?",
];

// From the README's technique table
export const TECHNIQUES = {
  baseline: "Plain embedding search. No extra model calls.",
  hybrid: "Adds a BM25 keyword search and fuses it with vector search.",
  hyde: "Writes a hypothetical answer and searches with that.",
  stepback: "Rewrites the question into a broader, principle-level one.",
  fanout: "Splits the query into three sub-questions and searches each.",
  cot: "Reasons step by step; the reasoning becomes the search query.",
  rerank: "Retrieves 20 candidates, then a reranker picks the best.",
  contextual: "Searches chunks indexed with an LLM-written line that places each in its document.",
};

export const SAMPLES = [
  {
    id: "eval",
    name: "Measure",
    line: "Score every technique from the command line.",
    lang: "bash",
    code: `# Score every technique on your own documents
npx ragforge eval --docs ./docs --json eval.json

# Free and local, with Ollama
ollama pull llama3.1 && ollama pull nomic-embed-text
npx ragforge eval --docs ./docs --provider ollama

# Add a reranker and a shareable HTML report
npx ragforge eval --docs ./docs --reranker cohere --html report.html

# PDFs and web pages work too
npx ragforge eval --docs handbook.pdf --docs https://example.com/faq`,
  },
  {
    id: "tune",
    name: "Tune",
    line: "Search chunking, embeddings and technique within a budget.",
    lang: "bash",
    code: `# Try chunking strategy x chunk size x embedding model x technique
npx ragforge tune --docs ./docs --budget 0.50 --html tune.html

# Plan: 18 setups ... then the best 3 with hyde, stepback, fanout ...
# Estimated cost: $0.0448, budget $0.5.
# ★ Best: sentence/800/text-embedding-3-small · baseline
#   found the right chunk 80% of the time vs 60% for the default setup
# Config written to ragforge.config.json

# Add reranking and contextual retrieval to the search
npx ragforge tune --docs ./docs --reranker cohere --contextual`,
  },
  {
    id: "auto",
    name: "Route",
    line: "One call picks the technique and answers.",
    lang: "js",
    code: `const { createRagforge } = require('ragforge');

const rf = createRagforge({ vectorStore: myVectorStore });

const result = await rf.auto('How do refunds work for annual plans?', {
  from: require('./eval.json'), // use what won in your eval
});

result.answer;        // "Annual plans are refunded pro rata [1] ..."
result.sources;       // [{ ref: 1, id, content, score, cited: true }, ...]
result.route.reason;  // why this technique was chosen
result.stats;         // { llmCalls, inputTokens, costUSD, latencyMs, ... }`,
  },
  {
    id: "index",
    name: "Index",
    line: "Only re-embed what changed. Keep it current while you edit.",
    lang: "js",
    code: `const { createRagforge, loadDocuments } = require('ragforge');

// The tuned chunking, embedding model and technique
const rf = createRagforge({ config: 'ragforge.config.json' });

const { changes, embedded, reused } = await rf.index(
  await loadDocuments('./docs'),
  { dir: '.ragforge/index' },
);
// changes: { added: ['docs/new.md'], updated: [], removed: [], unchanged: 41 }
// One edited paragraph re-embeds one chunk.

// Or from the terminal, updating on every save:
// npx ragforge index --docs ./docs --watch`,
  },
  {
    id: "frameworks",
    name: "Frameworks",
    line: "LangChain, the AI SDK, LlamaIndex and Mastra.",
    lang: "js",
    code: `// LangChain: a real BaseRetriever
const { createRagforgeRetriever } = require('ragforge/langchain');
const docs = await createRagforgeRetriever(rf).invoke('How long do refunds take?');

// Vercel AI SDK: a tool the model calls, or middleware for every call
const { createRagforgeTool, createRagforgeMiddleware } = require('ragforge/ai-sdk');
await generateText({ model, tools: { searchDocs: createRagforgeTool(rf) }, prompt });
const docsModel = wrapLanguageModel({ model, middleware: createRagforgeMiddleware(rf) });

// Mastra and LlamaIndex
const { createRagforgeTool: mastraTool } = require('ragforge/mastra');
const { createRagforgeRetriever: llamaRetriever } = require('ragforge/llamaindex');`,
  },
  {
    id: "store",
    name: "Plug in",
    line: "Pass the database client you already have.",
    lang: "js",
    code: `const { createRagforge } = require('ragforge');
const { createPgvectorStore } = require('ragforge/pgvector');

const rf = createRagforge({
  llm: 'anthropic',        // Claude writes the answer
  embeddings: 'openai',    // OpenAI embeds
  vectorStore: createPgvectorStore({ client: pool, table: 'docs' }),
  hybrid: true,            // Postgres full-text search next to pgvector
  reranker: 'cohere',
  cache: true,
});

// Or bring any store: one method is enough
createRagforge({ vectorStore: { query: async (vector, topK) => rows } });`,
  },
];

export const PROVIDERS = [
  { name: "openai", chat: "gpt-4o-mini", embed: "text-embedding-ada-002", key: "OPENAI_API_KEY" },
  { name: "ollama", chat: "llama3.1", embed: "nomic-embed-text", key: "none, runs locally" },
  { name: "anthropic", chat: "claude-sonnet-4-6", embed: null, key: "ANTHROPIC_API_KEY" },
  { name: "gemini", chat: "gemini-2.5-flash", embed: "gemini-embedding-001", key: "GEMINI_API_KEY" },
  { name: "mistral", chat: "mistral-small-latest", embed: "mistral-embed", key: "MISTRAL_API_KEY" },
  { name: "cohere", chat: "command-a-03-2025", embed: "embed-v4.0", key: "COHERE_API_KEY" },
  { name: "local", chat: null, embed: "bge-small-en-v1.5, in process", key: "none" },
];

export const STORES = ["pgvector", "Qdrant", "Chroma", "Pinecone", "LanceDB", "Supabase"];

export const FRAMEWORKS = [
  { name: "LangChain", path: "ragforge/langchain", line: "A real BaseRetriever returning LangChain Documents. Works with invoke, pipe and batch." },
  { name: "AI SDK", path: "ragforge/ai-sdk", line: "A tool the model calls when it needs the docs, or middleware that adds cited passages to every call." },
  { name: "LlamaIndex", path: "ragforge/llamaindex", line: "A real BaseRetriever returning scored TextNodes, for query engines and agents." },
  { name: "Mastra", path: "ragforge/mastra", line: "A tool for Mastra agents and workflows, with a plain JSON schema." },
];

export const DASHBOARD = [
  { name: "Eval runs", line: "Every question with the rank each technique found its passage at. Open one to see what was retrieved and the graded answer." },
  { name: "Compare", line: "Two runs side by side: what got better, what got worse, and whether --fail-on-drop would pass." },
  { name: "Tune runs", line: "The cost against quality chart, with the setups worth choosing between." },
  { name: "Traces and indexes", line: "The real queries your app answered, and a search box over a saved index." },
];

export const MCP_TOOLS = [
  { name: "search_docs", line: "The most relevant passages with their ids. Keyword search always, vectors when embeddings are set." },
  { name: "get_chunk", line: "One passage, plus the passage before and after it." },
  { name: "ask", line: "A cited answer when a chat model is set. Otherwise the matching passages." },
];

export const QUESTIONS = [
  {
    q: "Do I need a vector database?",
    a: "No. The eval indexes documents in memory, and rf.index() saves an incremental index to disk for docs sites, handbooks and repos. For large corpora use a vector database: any one works through vectorStore.",
  },
  {
    q: "How is this different from LangChain or LlamaIndex?",
    a: "They are frameworks; ragforge is the measurement and tuning layer, and it plugs into them. Use its retriever in LangChain or LlamaIndex, its tool or middleware in the AI SDK or Mastra, and score the retriever you have today next to ragforge's techniques. It has two runtime dependencies.",
  },
  {
    q: "What does tune cost, and how does it pick?",
    a: "You set a budget (default $0.50). It estimates every step before spending and pays for each distinct API call once. A setup only wins if it beats the default on clearly more questions, and a costlier technique has to beat the best free one by 5 points.",
  },
  {
    q: "Is the eval reliable?",
    a: "It measures whether each technique retrieves the chunk a question was written from. That is a good proxy for retrieval quality, not a full answer-quality benchmark. Use 20 or more questions, and add real user questions with --questions-file.",
  },
  {
    q: "What does it cost?",
    a: "ragforge is free. With the default gpt-4o-mini, a full pipeline query typically costs a fraction of a cent, and every result reports the exact costUSD. With Ollama it is free.",
  },
];
