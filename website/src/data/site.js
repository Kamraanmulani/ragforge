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
    id: "stream",
    name: "Stream",
    line: "Sources first, then the answer token by token.",
    lang: "js",
    code: `const result = await rf.auto('How long do refunds take?', { stream: true });

console.log(result.sources); // ready before the first token

for await (const token of result.stream) {
  process.stdout.write(token);
}

const answer = await result.answer;       // settles when the stream ends
const citations = await result.citations; // [1, 2]
const stats = await result.stats;         // cost and tokens for the whole call`,
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

export const MCP_TOOLS = [
  { name: "search_docs", line: "The most relevant passages with their ids. Keyword search always, vectors when embeddings are set." },
  { name: "get_chunk", line: "One passage, plus the passage before and after it." },
  { name: "ask", line: "A cited answer when a chat model is set. Otherwise the matching passages." },
];

export const QUESTIONS = [
  {
    q: "Do I need a vector database?",
    a: "No. The eval indexes documents in memory, and the techniques work without one. For production retrieval you will want one, and any database works through vectorStore.",
  },
  {
    q: "How is this different from LangChain or LlamaIndex?",
    a: "They are full frameworks. ragforge does one thing: it tells you which query technique helps on your data and applies it per query. It has two runtime dependencies and works next to whatever you already use.",
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
