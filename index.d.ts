// Type definitions for ragforge

export interface LLMOptions {
  model?: string;
  temperature?: number;
  max_tokens?: number;
  maxTokens?: number;
  top_p?: number;
  topP?: number;
  frequency_penalty?: number;
  frequencyPenalty?: number;
  presence_penalty?: number;
  presencePenalty?: number;
}

export interface Stats {
  llmCalls: number;
  embeddingCalls: number;
  rerankCalls: number;
  cacheHits: number;
  inputTokens: number;
  outputTokens: number;
  /** null when a model's price is unknown (add it via `pricing`) */
  costUSD: number | null;
  latencyMs: number;
}

export interface CallOptions extends LLMOptions {
  /** Called with usage stats once the call finishes */
  onStats?: (stats: Stats) => void;
}

export interface Usage {
  inputTokens?: number;
  outputTokens?: number;
}

export interface ChatParams {
  prompt: string;
  model: string;
  temperature?: number;
  maxTokens?: number;
  topP?: number;
  frequencyPenalty?: number;
  presencePenalty?: number;
}

/** Implement this to plug in any LLM / embedding backend */
export interface Provider {
  name: string;
  chatModel?: string;
  embeddingModel?: string;
  /** Optional token stream. Yields text and returns { model, usage } when the stream ends */
  chatStream?(params: LLMOptions & { prompt: string }): AsyncGenerator<string, { model?: string; usage?: { inputTokens?: number; outputTokens?: number } } | void, void>;
  /** Skip cost calculation (e.g. local models) */
  free?: boolean;
  chat(params: ChatParams): Promise<{ text: string; model?: string; usage?: Usage }>;
  embed(params: { text: string; model?: string }): Promise<{ vector: number[]; model?: string; usage?: Usage }>;
}

export interface OpenAIProvider extends Provider {
  setClient(client: unknown): void;
}

export interface VectorResult {
  content?: string;
  answer?: string;
  score?: number;
  id?: string | number;
  payload?: Record<string, unknown>;
  metadata?: Record<string, unknown>;
  [key: string]: unknown;
}

export interface VectorStore {
  query(vector: number[], topK: number): Promise<Array<VectorResult | string>>;
  /** Optional keyword search (e.g. BM25 or Postgres full-text), used by hybrid retrieval */
  searchText?(text: string, topK: number): Promise<Array<VectorResult | string>>;
}

export interface Cache {
  get(key: string): Promise<unknown | undefined>;
  set(key: string, value: unknown): Promise<void>;
}

export interface MemoryCache extends Cache {
  clear(): void;
  readonly size: number;
}

export type Price = { input?: number; output?: number; /** USD per rerank search */ perSearch?: number };

export interface Reranker {
  name: string;
  /** Looked up in `pricing` for cost tracking */
  model: string | null;
  free?: boolean;
  rerank(params: {
    query: string;
    documents: string[];
    topN: number;
    /** The instance's chat function, for LLM-based rerankers */
    chat: (prompt: string, options?: LLMOptions) => Promise<string>;
  }): Promise<{ results: Array<{ index: number; score: number }>; usage?: { searchUnits?: number; inputTokens?: number } }>;
}

export type RerankerInput = "llm" | "cohere" | "jina" | Reranker;

export type ProviderInput = "openai" | "ollama" | "anthropic" | "gemini" | "mistral" | "cohere" | "local" | Provider;

export type Technique = "hyde" | "cot" | "stepback" | "fanout";

export interface RagforgeOptions {
  llm?: ProviderInput;
  embeddings?: ProviderInput;
  vectorStore?: VectorStore;
  /** Default for ragPipeline/auto: also keyword-search each query (store needs searchText) */
  hybrid?: boolean;
  /** Reranker for rerank techniques and the `rerank` option */
  reranker?: RerankerInput;
  /** Default for ragPipeline/auto: rerank retrieved candidates (needs `reranker`) */
  rerank?: boolean;
  cache?: boolean | Cache;
  /** USD per 1M tokens, merged over DEFAULT_PRICING */
  pricing?: Record<string, Price>;
  defaults?: LLMOptions;
  debug?: boolean;
  logger?: { info?: (msg: string) => void; error?: (msg: string) => void };
  /**
   * Called with a trace of every auto() and ragPipeline() call. A file path appends
   * the traces to that file as JSONL, for `ragforge label` and `eval --from-logs`.
   * A hook that throws is logged and never fails the call.
   */
  onTrace?: ((trace: Trace) => void) | string;
  /**
   * The setup `ragforge tune` picked: a ragforge.config.json object or its path. Sets the
   * providers and models, the technique auto() uses, topK, and how rf.index() chunks.
   * Options passed here win over the config.
   */
  config?: TunedConfig | string;
}

/** One auto() or ragPipeline() call: what was asked, how it was routed, what the answer was written from */
export interface Trace {
  /** ISO 8601 */
  timestamp: string;
  type: "auto" | "ragPipeline";
  query: string;
  /** null for ragPipeline() */
  route: { technique: string; category: string; decidedBy: string; reason: string } | null;
  sources: Array<{ ref: number; id: string | number | null; score: number | null; cited: boolean; content?: string }>;
  citations: number[];
  answer?: string | null;
  stats: Stats | null;
}

export interface CotResult {
  reasoning: string;
  refinedQuery: string;
}

export interface StepbackResult {
  abstractQuery: string;
  originalQuery: string;
  reasoning: string;
}

export interface TranslateOptions extends CallOptions {
  techniques?: Technique[];
  techniqueOptions?: LLMOptions;
}

export interface Translation {
  originalQuery: string;
  hyde: string | null;
  cot: CotResult | null;
  stepback: StepbackResult | null;
  fanout: string | null;
  subQueries: string[];
}

export interface PipelineOptions extends TranslateOptions {
  /** Return the answer as a stream of tokens (see StreamingResult) */
  stream?: boolean;
  topK?: number;
  rerankK?: number;
  /** Also keyword-search the query and fuse with RRF (store needs searchText) */
  hybrid?: boolean;
  /** Retrieve `rerankK` candidates and reorder them with the reranker */
  rerank?: boolean;
  /** Ask the LLM to cite passages as [1], [2] (default true) */
  citations?: boolean;
  finalModelOptions?: LLMOptions;
}

export interface Source {
  /** The number the answer cites it by: [1], [2], ... */
  ref: number;
  id: string | number | null;
  content: string;
  /** The vector store's score, when it returns one */
  score: number | null;
  metadata: Record<string, unknown> | null;
  /** Whether the answer cites this passage */
  cited: boolean;
}

export interface PipelineResult {
  query: string;
  translation: Translation;
  retrieved: string[];
  /** Passages the answer was written from (empty without a vector store) */
  sources: Source[];
  /** Source numbers the answer cites, ascending */
  citations: number[];
  answer: string;
  stats: Stats;
}

export type EvalTechnique = "baseline" | "hybrid" | "rerank" | "contextual" | Technique | (string & {});

export interface EvalQuestion {
  question: string;
  /** Id of the chunk/result that answers it */
  expectedId?: string | number;
  /** Text the answering chunk contains (case-insensitive) */
  expectedText?: string;
  /** Reference answer. With `answers`, context recall is judged against it when the expected chunk was missed */
  expectedAnswer?: string;
}

export interface EvaluateOptions {
  /** Corpus to chunk and index in memory. Omit to use the instance's vectorStore. */
  documents?: Array<string | { id?: string; content: string }>;
  /** Ground-truth questions. Generated from the documents when omitted. */
  questions?: EvalQuestion[];
  numQuestions?: number;
  /** Mix of generated question styles (default all three, cycled) */
  questionStyles?: Array<"question" | "keywords" | "conceptual">;
  /** e.g. ["baseline", "hybrid", "hyde", "hybrid+hyde"]. "hybrid" needs `documents` or a store with searchText */
  techniques?: EvalTechnique[];
  topK?: number;
  /** Candidates retrieved for rerank techniques (default 20) */
  rerankCandidates?: number;
  /** Max characters per chunk (default 800) */
  chunkSize?: number;
  /** How `documents` are split (default "paragraph"). "semantic" makes one embedding call per sentence */
  chunkStrategy?: ChunkStrategy;
  /** Characters repeated between chunks, "fixed" and "sentence" only (default 0) */
  chunkOverlap?: number;
  concurrency?: number;
  /** Hit-rate gain over baseline needed to recommend a technique (default 0.05) */
  minImprovement?: number;
  llmOptions?: LLMOptions;
  /**
   * Also write an answer from each technique's passages and grade it with an LLM judge:
   * faithfulness, answer relevance, context recall and citation accuracy
   */
  answers?: boolean;
  /** LLM options for the judge, e.g. { model: "gpt-4o" } (default: llmOptions, at temperature 0) */
  judgeOptions?: LLMOptions;
  /** Add "contextual" and "contextual+hybrid" to the default techniques */
  contextual?: boolean;
  /** For contextual techniques: the model, cache, budget and document window for context lines */
  contextOptions?: ContextOptions;
  onProgress?: (progress: { phase: "index" | "context" | "context-index" | "questions" | "run" | "answers"; done: number; total: number }) => void;
}

export interface ContextOptions {
  /** Chat model that writes the context lines (default: the instance's) */
  model?: string;
  llmOptions?: LLMOptions;
  /** Keeps context lines between runs, e.g. createFileCache(".ragforge/context-cache.json") */
  cache?: Cache;
  /** Refuse to start when the estimated cost is higher (USD) */
  budgetUSD?: number;
  /** Document text shown with each chunk; longer documents are cut to a window around it (default 24000) */
  maxDocumentChars?: number;
  /** Parallel LLM calls (default 4) */
  concurrency?: number;
  /** Called with the estimate before any LLM call */
  onEstimate?: (estimate: ContextEstimate) => void;
  onProgress?: (progress: { phase: "context"; done: number; total: number }) => void;
}

export interface ContextEstimate {
  chunks: number;
  /** Chunks whose context line is already in the cache */
  cached: number;
  /** LLM calls still to make */
  calls: number;
  /** Estimated from characters, about 4 per token */
  inputTokens: number;
  outputTokens: number;
  model: string;
  /** null when the model has no known price (add it with `pricing`); 0 for free providers */
  costUSD: number | null;
}

export interface ContextualChunk extends Chunk {
  /** The LLM-written line that places the chunk in its document ("" when its call failed) */
  context: string;
  /** context + chunk: the text to embed and keyword-index. Show `content` to users */
  indexText: string;
}

export interface ContextualizeResult {
  chunks: ContextualChunk[];
  estimate: ContextEstimate;
  /** Context lines taken from the cache */
  cached: number;
  /** Chunks whose call failed; they are indexed without context */
  failed: number;
  errors: Array<{ id: string; error: string }>;
  stats: Stats;
}

/**
 * How documents are split into chunks:
 * - paragraph: packs whole paragraphs (default)
 * - fixed: windows of characters cut at a word, with optional overlap
 * - sentence: packs whole sentences, with optional overlap
 * - markdown-heading: one section per chunk, starting with its heading trail ("Setup > Windows")
 * - semantic: sentences, split where the topic shifts (needs embeddings)
 * - code: source files split by top-level declaration; other documents by paragraph
 */
export type ChunkStrategy = "paragraph" | "fixed" | "sentence" | "markdown-heading" | "semantic" | "code";

export interface ChunkOptions {
  /** Max characters per chunk (default 800) */
  size?: number;
  strategy?: ChunkStrategy;
  /** Characters repeated between chunks, "fixed" and "sentence" only (default 0) */
  overlap?: number;
}

export interface ChunkDocumentsOptions extends ChunkOptions {
  /** Embeds one text; needed for "semantic" */
  embed?: (text: string) => Promise<number[]>;
  /** semantic: percentile of drops in similarity between sentences that start a new chunk, 0 to 1 (default 0.9) */
  breakpoint?: number;
  /** semantic: parallel embedding calls (default 4) */
  concurrency?: number;
}

export interface Chunk {
  /** "<docId>#<n>", counting from 1 */
  id: string;
  docId: string;
  content: string;
  /** markdown-heading: the heading trail that `content` starts with, e.g. "Setup > Windows" */
  heading?: string;
}

/** Answer-quality scores from 0 to 1. null when a metric could not be scored */
export interface AnswerScores {
  /** Share of the answer's claims that the retrieved passages support */
  faithfulness: number | null;
  /** Whether the answer addresses the question: 0, 0.5 or 1 per answer */
  answerRelevance: number | null;
  /** Share of the facts needed for the answer that were retrieved */
  contextRecall: number | null;
  /** Share of the answer's [n] citations whose passage supports the cited statement */
  citationAccuracy: number | null;
}

export interface EvalAnswerSummary extends AnswerScores {
  /** Half-width of each mean's 95% confidence interval across questions. null with fewer than 2 scores */
  ci: AnswerScores;
  /** Questions that got an answer */
  judged: number;
  /** Questions where the answer or one of the judge calls failed */
  errors: number;
}

export interface EvalRow {
  technique: string;
  hitRate: number;
  mrr: number;
  avgLatencyMs: number;
  avgCostUSD: number | null;
  totalCostUSD: number | null;
  avgLlmCalls: number;
  errors: number;
  /** Answer quality, when the eval ran with `answers`. Cost and latency above cover retrieval only */
  answers?: EvalAnswerSummary;
}

export interface EvalRun {
  /** 1-based rank of the expected result, 0 when missed */
  rank: number;
  queries: string[];
  retrieved: string[];
  error?: string;
  /** With `answers`: the answer written from the retrieved passages, null when it failed */
  answer?: string | null;
  scores?: AnswerScores;
  /** What lowered a score. The judge has to quote the passages for everything it accepts; these had no valid quote */
  findings?: { unsupportedClaims?: string[]; missingFacts?: string[]; wrongCitations?: string[] };
  /** Why the answer or a metric could not be scored, by metric name */
  judgeErrors?: Record<string, string>;
}

export interface EvalResult {
  topK: number;
  questionCount: number;
  chunkCount: number | null;
  /** How the documents were split. null when evaluating your own vector store */
  chunking?: { strategy: ChunkStrategy; size: number; overlap: number } | null;
  /** Present when contextual techniques ran: what writing and indexing the context lines cost, once */
  contextual?: {
    model: string;
    chunks: number;
    /** Chunks that got a context line */
    contextualized: number;
    cached: number;
    failed: number;
    estimate: ContextEstimate;
    usage: Stats;
  };
  techniques: string[];
  provider: { llm: string; chatModel: string; embeddings: string; embeddingModel: string };
  /** Usage for indexing and question generation */
  setup: Stats;
  results: EvalRow[];
  ranking: string[];
  best: string;
  recommendation: { technique: string; reason: string };
  /** Present when the eval ran with `answers` */
  answers?: {
    /** Version of the fixed judge prompts. Scores are comparable only between runs with the same version */
    judgeVersion: number;
    judgeModel: string;
    /** Answers written and graded. Techniques that retrieved the same passages share one */
    generated: number;
    /** Usage for writing and grading the answers, apart from the techniques' own */
    usage: Stats;
  };
  questions: Array<EvalQuestion & { source?: string; style?: "question" | "keywords" | "conceptual"; runs: Record<string, EvalRun> }>;
}

export interface MemoryVectorStore extends VectorStore {
  add(entries: Array<{ id: string; content: string; vector: number[]; metadata?: Record<string, unknown> }>): void;
  query(vector: number[], topK?: number): Promise<Array<{ id: string; content: string; score: number; metadata?: Record<string, unknown> }>>;
  /** BM25 keyword search over the added entries */
  searchText(text: string, topK?: number): Promise<Array<{ id: string; content: string; score: number; metadata?: Record<string, unknown> }>>;
  readonly size: number;
}

export interface BM25Index {
  add(entries: Array<{ id: string; content: string; metadata?: Record<string, unknown> }>): void;
  search(text: string, topK?: number): Array<{ id: string; content: string; score: number; metadata?: Record<string, unknown> }>;
  readonly size: number;
}

export type QueryCategory = "comparison" | "exact" | "short" | "conceptual" | "simple";

export interface RouteOptions extends CallOptions {
  /** How to classify the query: free rules (default) or one small LLM call */
  router?: "rules" | "llm";
  /** An evaluate() result (or its saved JSON) to learn technique choices from */
  from?: EvalResult;
  /** Techniques the router may pick (ignored with `from`) */
  techniques?: EvalTechnique[];
  /** Override the technique for a category, e.g. { short: "hyde+stepback" } */
  rules?: Partial<Record<QueryCategory, EvalTechnique>>;
  /** LLM options for the "llm" classifier */
  routerOptions?: LLMOptions;
  /** With `from`: questions a category needs before its own result is trusted (default 3) */
  minSamples?: number;
  /** With `from`: hit-rate gain over baseline needed to pick a technique (default 0.05) */
  minImprovement?: number;
}

export interface Route {
  technique: string;
  category: QueryCategory;
  classifier: "rules" | "llm" | "config";
  /** "config": the technique from a tuned config (createRagforge({ config })) */
  decidedBy: "rules" | "eval" | "config";
  reason: string;
}

export interface AutoOptions extends RouteOptions {
  topK?: number;
  rerankK?: number;
  /** Force keyword search on or off; by default it follows the routed technique */
  hybrid?: boolean;
  /** Force reranking on or off; by default it follows the routed technique */
  rerank?: boolean;
  /** Ask the LLM to cite passages as [1], [2] (default true) */
  citations?: boolean;
  techniqueOptions?: LLMOptions;
  finalModelOptions?: LLMOptions;
}

export interface AutoResult extends PipelineResult {
  route: Route;
}

/** Returned by auto({ stream: true }) and ragPipeline({ stream: true }). Sources are ready before the first token. */
export interface StreamingResult extends Omit<PipelineResult, "answer" | "citations" | "stats"> {
  /** Answer tokens, in order. Read it to the end: answer, citations, stats and done settle after that */
  stream: AsyncGenerator<string, void, void>;
  answer: Promise<string>;
  citations: Promise<number[]>;
  /** Full result once the stream has ended */
  done: Promise<PipelineResult>;
  stats: Promise<Stats>;
}

export interface StreamingAutoResult extends StreamingResult {
  route: Route;
}

export interface Ragforge {
  /** Pick a technique for the query without running it */
  route(query: string, options?: RouteOptions): Promise<Route>;
  /** Pick a technique for the query, then run the pipeline with it */
  auto(query: string, options: AutoOptions & { stream: true }): Promise<StreamingAutoResult>;
  auto(query: string, options?: AutoOptions): Promise<AutoResult>;
  /** Benchmark retrieval techniques on your data and get a recommendation */
  evaluate(options: EvaluateOptions): Promise<EvalResult>;
  /**
   * Contextual retrieval: an LLM writes a line placing each chunk in its document.
   * Embed and keyword-index `indexText`; show `content`. Pass the documents the chunks came from.
   */
  contextualize(chunks: Chunk[], documents: Array<string | { id?: string; content: string }>, options?: ContextOptions): Promise<ContextualizeResult>;
  /** What contextualize() would cost, without calling the LLM */
  estimateContextCost(chunks: Chunk[], documents: Array<string | { id?: string; content: string }>, options?: ContextOptions): Promise<ContextEstimate>;
  hyde(query: string, options?: CallOptions): Promise<string>;
  cot(query: string, options?: CallOptions): Promise<CotResult>;
  stepback(query: string, options?: CallOptions): Promise<StepbackResult>;
  fanout(query: string, options?: CallOptions): Promise<string>;
  translate(query: string, options?: TranslateOptions): Promise<Translation>;
  ragPipeline(query: string, options?: PipelineOptions): Promise<PipelineResult>;
  callLLM(prompt: string, options?: CallOptions): Promise<string>;
  getEmbedding(text: string, options?: { model?: string; onStats?: (stats: Stats) => void }): Promise<number[]>;
  rrf<T = string>(rankedLists: T[][], k?: number): string[];
  setVectorStore(store: VectorStore | null): void;
  readonly llm: Provider;
  readonly embedder: Provider;
  readonly cache: Cache | null;
  /** Find the best retrieval setup for your documents within a budget */
  tune(options: TuneOptions): Promise<TuneResult>;
  /**
   * Chunk and embed documents into an in-memory store (vectors + BM25) and use it.
   * With a tuned config, chunking and contextual retrieval follow the config.
   * With `dir`, the index is saved there and later calls only redo what changed.
   */
  index(documents: Array<string | { id?: string; content: string }>, options: IndexOptions & { dir: string }): Promise<SyncResult>;
  index(
    documents: Array<string | { id?: string; content: string }>,
    options?: IndexOptions
  ): Promise<{ count: number; contextual: ContextualizeResult | null; store: MemoryVectorStore }>;
  /** Use an index saved with index(documents, { dir }) or `ragforge index`, without the documents */
  loadIndex(dir: string): { count: number; store: MemoryVectorStore; manifest: IndexManifest };
  /** The tuned config this instance was created with, or null */
  readonly config: TunedConfig | null;
}

export function createRagforge(options?: RagforgeOptions): Ragforge;

export function createOpenAIProvider(options?: {
  client?: unknown;
  apiKey?: string;
  baseURL?: string;
  chatModel?: string;
  embeddingModel?: string;
}): OpenAIProvider;

/** In-process embeddings with @huggingface/transformers (npm install @huggingface/transformers). No key. */
export function createLocalProvider(options?: { embeddingModel?: string }): Provider;
export function createAnthropicProvider(options?: { apiKey?: string; baseURL?: string; chatModel?: string }): Provider;
export function createGeminiProvider(options?: { apiKey?: string; baseURL?: string; chatModel?: string; embeddingModel?: string }): Provider;
export function createMistralProvider(options?: { apiKey?: string; baseURL?: string; chatModel?: string; embeddingModel?: string }): Provider;
export function createCohereProvider(options?: { apiKey?: string; baseURL?: string; chatModel?: string; embeddingModel?: string }): Provider;
export function createOllamaProvider(options?: {
  baseURL?: string;
  chatModel?: string;
  embeddingModel?: string;
  headers?: Record<string, string>;
}): Provider;

export function createMemoryCache(options?: { maxEntries?: number }): MemoryCache;

export interface FileCache extends Cache {
  readonly file: string;
  /** Save pending writes now (they are also saved shortly after each write, and at exit) */
  flush(): Promise<void>;
  clear(): void;
  readonly size: number;
}

/** A cache kept in a JSON file, so entries survive between runs */
export function createFileCache(file: string, options?: { flushMs?: number }): FileCache;

export function createLLMReranker(options?: { maxChars?: number; llmOptions?: LLMOptions }): Reranker;
export function createCohereReranker(options?: { apiKey?: string; model?: string; baseURL?: string; fetch?: typeof fetch }): Reranker;
export function createJinaReranker(options?: { apiKey?: string; model?: string; baseURL?: string; fetch?: typeof fetch }): Reranker;

export function createMemoryVectorStore(): MemoryVectorStore;

/** Zero-dependency BM25 keyword index, e.g. to add searchText() to your own store */
export function createBM25Index(options?: { k1?: number; b?: number }): BM25Index;

/** Splits one text. Every strategy but "semantic", which needs chunkDocuments() with `embed` */
export function chunkText(text: string, options?: ChunkOptions): string[];

/** Splits documents into chunks with ids "<docId>#<n>". Repeated document ids get a "~2" suffix */
export function chunkDocuments(
  documents: Array<string | { id?: string; content: string }>,
  options?: ChunkDocumentsOptions
): Promise<Chunk[]>;

export const CHUNK_STRATEGIES: ChunkStrategy[];

export interface IndexOptions {
  /** Save the index here and keep it up to date on later calls (e.g. ".ragforge/index") */
  dir?: string;
  chunkSize?: number;
  chunkStrategy?: ChunkStrategy;
  chunkOverlap?: number;
  contextual?: boolean;
  contextOptions?: ContextOptions;
  concurrency?: number;
  onProgress?: (p: { phase: "context" | "index" | "embed"; done: number; total: number }) => void;
}

/** What rf.index(documents, { dir }) changed */
export interface SyncResult {
  dir: string;
  count: number;
  store: MemoryVectorStore;
  entries: Array<{ id: string; docId: string; content: string; indexText?: string; context?: string; heading?: string; vector: number[] }>;
  /** Document ids, by what happened to them */
  changes: { added: string[]; updated: string[]; removed: string[]; unchanged: number };
  /** Chunks embedded in this call */
  embedded: number;
  /** Chunks of edited documents whose text (and vector) didn't change */
  reused: number;
  /** Why everything was redone ("chunk size 800 → 400"), or null */
  rebuilt: string | null;
  /** Why a damaged saved index was rebuilt, or null */
  problem: string | null;
  /** false when nothing changed and nothing was written */
  saved: boolean;
  contextual: ContextualizeResult | null;
  context: ContextualizeResult | null;
  manifest: IndexManifest;
  stats: Stats;
}

/** manifest.json of a saved index */
export interface IndexManifest {
  version: 1;
  generation: string;
  ragforge: string;
  savedAt: string;
  settings: { chunking: { strategy: ChunkStrategy; size: number; overlap: number }; embeddings: string | null; contextual: string | null };
  chunkCount: number;
  documents: Record<string, { hash: string; chunks: string[]; source?: string }>;
}

export interface McpServerOptions {
  /** Documents from loadDocuments() */
  documents: Array<{ id: string; content: string }>;
  /** Passages per search_docs / ask call when the agent doesn't say (default 5) */
  topK?: number;
  /** A tuned config: `ask` answers with its technique */
  config?: TunedConfig | string;
  /** Keep a saved index here and bring it up to date at startup */
  indexDir?: string;
  /** Re-read the documents with load() and update the index when a file in sources changes */
  watch?: { sources: string[]; cwd?: string; load: () => Promise<Array<{ id: string; content: string }>> } | null;
  /** Max characters per passage (default 800) */
  chunkSize?: number;
  /** How documents are split (default "paragraph"). "semantic" needs an embedder */
  chunkStrategy?: ChunkStrategy;
  /** Characters repeated between passages, "fixed" and "sentence" only (default 0) */
  chunkOverlap?: number;
  /** Give each passage an LLM-written context line before indexing (needs llm) */
  contextual?: boolean;
  contextOptions?: ContextOptions;
  /** Parallel embedding requests while indexing (default 4) */
  concurrency?: number;
  /** Embedding provider for vector search. Omit for keyword search only (no key). */
  embedder?: unknown;
  /** Chat provider for the ask tool. Omit to get passages instead of answers. */
  llm?: unknown;
  stdin?: NodeJS.ReadableStream;
  stdout?: NodeJS.WritableStream;
  stderr?: NodeJS.WritableStream;
}

/** Serves documents to MCP clients (search_docs, get_chunk, ask) over stdio until stdin closes */
export function startMcpServer(options: McpServerOptions): Promise<void>;

export interface LoadedDocument {
  /** Relative file path ("docs/a.md") or the URL */
  id: string;
  content: string;
  metadata: { source: string; type: string };
}

/**
 * Read files, folders (recursively) and http(s) URLs: .txt, .md, .mdx, .rst, .html,
 * .pdf (needs `unpdf`) and .docx (needs `mammoth`)
 */
export function loadDocuments(
  sources: string | string[],
  options?: {
    cwd?: string;
    concurrency?: number;
    fetch?: typeof fetch;
    /** Also read source code files from folders, for the "code" chunking strategy */
    code?: boolean;
  }
): Promise<LoadedDocument[]>;

/** Readable text from an HTML page, keeping headings, paragraphs and list items */
export function htmlToText(html: string): string;

/** Plain-text scoreboard for an evaluate() result */
export function formatTable(result: EvalResult): string;

/** The setup ragforge tune picked, as written to ragforge.config.json */
export interface TunedConfig {
  version: 1;
  /** Built-in provider name for chat (e.g. "openai") */
  llm?: string;
  chatModel?: string;
  /** Built-in provider name for embeddings */
  embeddings?: string;
  embeddingModel?: string;
  chunking: { strategy: ChunkStrategy; size: number; overlap: number };
  /** Index with context lines (rf.index does) */
  contextual: boolean;
  /** The eval technique to use for every query, e.g. "hybrid" or "hybrid+hyde" */
  technique: string;
  hybrid: boolean;
  rerank: boolean;
  reranker: string | null;
  topK: number;
  /** How the setup scored when it was tuned */
  tuned?: {
    at: string;
    ragforge: string;
    questions: number;
    hitRate: number;
    mrr: number;
    avgCostUSD: number | null;
    indexCostUSD: number | null;
    default: { hitRate: number; mrr: number } | null;
    reason: string;
  };
}

export interface TuneOptions {
  documents: Array<string | { id?: string; content: string }>;
  /** Ground truth matched by text (chunk ids change with the chunking). Generated when omitted */
  questions?: Array<{ question: string; expectedText?: string; source?: string; expectedAnswer?: string }>;
  /** Questions to generate (default 20) */
  numQuestions?: number;
  questionStyles?: Array<"question" | "keywords" | "conceptual">;
  /** Default ["paragraph", "markdown-heading", "sentence"] */
  chunkStrategies?: ChunkStrategy[];
  /** Default [400, 800, 1200] */
  chunkSizes?: number[];
  /** Default: the embedder's model, plus text-embedding-3-small with OpenAI */
  embeddingModels?: string[];
  /** Techniques tried on the best setups (every setup gets baseline and hybrid) */
  techniques?: EvalTechnique[];
  /** Also try contextual retrieval on the best setups */
  contextual?: boolean;
  contextOptions?: ContextOptions;
  /** Setups that get the costlier techniques (default 3) */
  topSetups?: number;
  /** Most the run may spend, in USD (default 0.5). null for no limit */
  budgetUSD?: number | null;
  topK?: number;
  rerankCandidates?: number;
  /** Gain a costlier technique needs over the best free one (default 0.05) */
  minImprovement?: number;
  /**
   * To replace what it competes with (the default setup, or the best free trial), a trial must
   * rank the right chunk higher on this many more questions than it ranks it lower (default 2)
   */
  minGainQuestions?: number;
  concurrency?: number;
  llmOptions?: LLMOptions;
  /** Called with the plan and its cost estimate before anything is spent */
  onPlan?: (plan: TunePlan) => void;
  onProgress?: (progress: { phase: "questions" | "screen" | "refine"; step?: number; steps?: number; setup?: string; detail?: string; done: number; total: number }) => void;
}

export interface TunePlan {
  setups: number;
  chunkStrategies: ChunkStrategy[];
  chunkSizes: number[];
  embeddingModels: string[];
  screenTechniques: string[];
  refineTechniques: string[];
  topSetups: number;
  questions: number;
  generateQuestions: boolean;
  budgetUSD: number | null;
  /** USD; null when a price is unknown */
  estimate: { questions: number | null; screening: number | null; refining: number | null; total: number | null };
}

/** One index setup with one technique */
export interface TuneTrial {
  /** "<strategy>/<size>/<embedding model> <technique>" */
  id: string;
  setupId: string;
  setup: { chunkStrategy: ChunkStrategy; chunkSize: number; embeddingModel: string };
  /** The default setup's baseline: what you'd get without tuning */
  isDefault: boolean;
  technique: string;
  stage: "screen" | "refine";
  hitRate: number;
  mrr: number;
  avgCostUSD: number | null;
  avgLatencyMs: number;
  avgLlmCalls: number;
  errors: number;
  /** Rank of the right chunk for each question, 0 when it wasn't retrieved */
  ranks: number[];
  chunkCount: number | null;
  /** Average chunk length: bigger chunks send more text to the LLM with every answer */
  avgChunkChars: number;
  /** Paid once per index build: chunk embeddings, plus context lines for contextual */
  indexCostUSD: number | null;
}

export interface TuneResult {
  version: 1;
  topK: number;
  questionCount: number;
  budgetUSD: number | null;
  /** What the run really spent (repeated calls are made once) */
  spent: Stats;
  /** Why the search stopped before the end, or null */
  stopped: string | null;
  plan: TunePlan;
  /** Trial ids */
  best: string;
  default: string | null;
  reason: string;
  /** Trials no other trial beats on both quality and cost, cheapest first */
  pareto: string[];
  trials: TuneTrial[];
  /** Write this to ragforge.config.json */
  config: TunedConfig;
  provider: { llm: string; chatModel: string | null; embeddings: string };
  warnings: string[];
  questions: Array<{ question: string; expectedText: string; style?: string; source?: string }>;
}

/** Read and check a ragforge.config.json (object or path) */
export function loadConfig(config: TunedConfig | string, options?: { cwd?: string }): TunedConfig;

/** Plain-text summary of a tune() result */
export function formatTuneTable(result: TuneResult, options?: { rows?: number }): string;

/** Self-contained HTML page with the cost/quality chart and every trial */
export function renderTuneHtml(result: TuneResult, options?: { title?: string }): string;

/** Standalone HTML report for an evaluate() result */
export function renderHtmlReport(result: EvalResult, options?: { title?: string }): string;

/** A score in the baseline and in the current run. `delta` is after minus before, null when either is missing */
export interface EvalChange {
  before: number | null;
  after: number | null;
  delta: number | null;
}

export interface EvalComparisonRow {
  technique: string;
  /** regressed: hit rate or faithfulness fell by more than failOnDrop points. new / removed: in only one of the runs */
  status: "regressed" | "down" | "up" | "same" | "new" | "removed";
  /** The scores that fell by more than failOnDrop points */
  regressedOn: Array<"hitRate" | "faithfulness">;
  hitRate: EvalChange;
  mrr: EvalChange;
  /** All null unless both runs have answer scores */
  faithfulness: EvalChange;
  avgLatencyMs: EvalChange;
  avgCostUSD: EvalChange;
}

export interface EvalComparison {
  topK: number;
  failOnDrop: number | null;
  /** Whether faithfulness was compared (both runs have answer scores) */
  answers: boolean;
  rows: EvalComparisonRow[];
  /** Techniques whose hit rate or faithfulness fell by more than failOnDrop points */
  regressions: string[];
  /** false when there is at least one regression */
  passed: boolean;
  /** Reasons the two runs may not be comparable (different questions, top-k or embedding model) */
  warnings: string[];
}

/** The parts of an eval result a comparison reads, so a result loaded from `--json` works too */
export type EvalSnapshot = Pick<EvalResult, "topK" | "questionCount" | "results"> & Partial<EvalResult>;

/**
 * Compare two evaluate() results technique by technique.
 * With `failOnDrop`, a technique that lost more than that many points of hit rate is a regression.
 * When both runs have answer scores, the same limit applies to faithfulness.
 */
export function compareEvals(baseline: EvalSnapshot, current: EvalSnapshot, options?: { failOnDrop?: number }): EvalComparison;

/** Plain-text diff of two eval results, from compareEvals() */
export function formatComparison(comparison: EvalComparison, options?: { baselineName?: string }): string;

/** Markdown scoreboard for pull request comments. Pass `comparison` to show each score next to the baseline's */
export function renderMarkdownReport(
  result: EvalResult,
  options?: { comparison?: EvalComparison | null; baselineName?: string; title?: string }
): string;

/**
 * An onTrace hook that appends each trace to a JSONL file.
 * `includeText: false` leaves out passage text and answers, keeping queries, routes, source ids and stats.
 */
export function createTraceLogger(file: string, options?: { includeText?: boolean }): (trace: Trace) => void;

/** Reads a JSONL trace file. Lines that aren't JSON or have no query are skipped and counted */
export function readTraces(file: string): { traces: Trace[]; skipped: number };

/** Version of the fixed judge prompts used by evaluate({ answers: true }) */
export const JUDGE_VERSION: number;

/** Rule-based query category, no LLM call */
export function classifyQuery(query: string): { category: QueryCategory; reason: string };

/** Default technique per query category */
export const DEFAULT_RULES: Record<QueryCategory, EvalTechnique>;

export const DEFAULT_PRICING: Record<string, Price>;

// v1 API (default OpenAI instance)
export function hyde(query: string, options?: CallOptions): Promise<string>;
export function cot(query: string, options?: CallOptions): Promise<CotResult>;
export function stepback(query: string, options?: CallOptions): Promise<StepbackResult>;
export function fanout(query: string, options?: CallOptions): Promise<string>;
export function ragPipeline(query: string, options?: PipelineOptions): Promise<PipelineResult>;
export function auto(query: string, options: AutoOptions & { stream: true }): Promise<StreamingAutoResult>;
export function auto(query: string, options?: AutoOptions): Promise<AutoResult>;
export function rrf<T = string>(rankedLists: T[][], k?: number): string[];
export function setVectorClient(client: VectorStore | null): void;
export function callLLM(prompt: string, options?: CallOptions): Promise<string>;
export function getEmbedding(text: string, model?: string): Promise<number[]>;
export function setOpenAIClient(client: unknown): void;
