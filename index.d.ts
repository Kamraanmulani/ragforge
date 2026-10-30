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

export type ProviderInput = "openai" | "ollama" | Provider;

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

export type EvalTechnique = "baseline" | "hybrid" | "rerank" | Technique | (string & {});

export interface EvalQuestion {
  question: string;
  /** Id of the chunk/result that answers it */
  expectedId?: string | number;
  /** Text the answering chunk contains (case-insensitive) */
  expectedText?: string;
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
  chunkSize?: number;
  concurrency?: number;
  /** Hit-rate gain over baseline needed to recommend a technique (default 0.05) */
  minImprovement?: number;
  llmOptions?: LLMOptions;
  onProgress?: (progress: { phase: "index" | "questions" | "run"; done: number; total: number }) => void;
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
}

export interface EvalRun {
  /** 1-based rank of the expected result, 0 when missed */
  rank: number;
  queries: string[];
  retrieved: string[];
  error?: string;
}

export interface EvalResult {
  topK: number;
  questionCount: number;
  chunkCount: number | null;
  techniques: string[];
  provider: { llm: string; chatModel: string; embeddings: string; embeddingModel: string };
  /** Usage for indexing and question generation */
  setup: Stats;
  results: EvalRow[];
  ranking: string[];
  best: string;
  recommendation: { technique: string; reason: string };
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
  classifier: "rules" | "llm";
  decidedBy: "rules" | "eval";
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

export interface Ragforge {
  /** Pick a technique for the query without running it */
  route(query: string, options?: RouteOptions): Promise<Route>;
  /** Pick a technique for the query, then run the pipeline with it */
  auto(query: string, options?: AutoOptions): Promise<AutoResult>;
  /** Benchmark retrieval techniques on your data and get a recommendation */
  evaluate(options: EvaluateOptions): Promise<EvalResult>;
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
}

export function createRagforge(options?: RagforgeOptions): Ragforge;

export function createOpenAIProvider(options?: {
  client?: unknown;
  apiKey?: string;
  baseURL?: string;
  chatModel?: string;
  embeddingModel?: string;
}): OpenAIProvider;

export function createOllamaProvider(options?: {
  baseURL?: string;
  chatModel?: string;
  embeddingModel?: string;
  headers?: Record<string, string>;
}): Provider;

export function createMemoryCache(options?: { maxEntries?: number }): MemoryCache;

export function createLLMReranker(options?: { maxChars?: number; llmOptions?: LLMOptions }): Reranker;
export function createCohereReranker(options?: { apiKey?: string; model?: string; baseURL?: string; fetch?: typeof fetch }): Reranker;
export function createJinaReranker(options?: { apiKey?: string; model?: string; baseURL?: string; fetch?: typeof fetch }): Reranker;

export function createMemoryVectorStore(): MemoryVectorStore;

/** Zero-dependency BM25 keyword index, e.g. to add searchText() to your own store */
export function createBM25Index(options?: { k1?: number; b?: number }): BM25Index;

export function chunkText(text: string, options?: { size?: number }): string[];

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
  options?: { cwd?: string; concurrency?: number; fetch?: typeof fetch }
): Promise<LoadedDocument[]>;

/** Readable text from an HTML page, keeping headings, paragraphs and list items */
export function htmlToText(html: string): string;

/** Plain-text scoreboard for an evaluate() result */
export function formatTable(result: EvalResult): string;

/** Standalone HTML report for an evaluate() result */
export function renderHtmlReport(result: EvalResult, options?: { title?: string }): string;

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
export function auto(query: string, options?: AutoOptions): Promise<AutoResult>;
export function rrf<T = string>(rankedLists: T[][], k?: number): string[];
export function setVectorClient(client: VectorStore | null): void;
export function callLLM(prompt: string, options?: CallOptions): Promise<string>;
export function getEmbedding(text: string, model?: string): Promise<number[]>;
export function setOpenAIClient(client: unknown): void;
