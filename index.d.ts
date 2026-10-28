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
}

export interface Cache {
  get(key: string): Promise<unknown | undefined>;
  set(key: string, value: unknown): Promise<void>;
}

export interface MemoryCache extends Cache {
  clear(): void;
  readonly size: number;
}

export type Price = { input?: number; output?: number };

export type ProviderInput = "openai" | "ollama" | Provider;

export type Technique = "hyde" | "cot" | "stepback" | "fanout";

export interface RagforgeOptions {
  llm?: ProviderInput;
  embeddings?: ProviderInput;
  vectorStore?: VectorStore;
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
  finalModelOptions?: LLMOptions;
}

export interface PipelineResult {
  query: string;
  translation: Translation;
  retrieved: string[];
  answer: string;
  stats: Stats;
}

export interface Ragforge {
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

export const DEFAULT_PRICING: Record<string, Price>;

// v1 API (default OpenAI instance)
export function hyde(query: string, options?: CallOptions): Promise<string>;
export function cot(query: string, options?: CallOptions): Promise<CotResult>;
export function stepback(query: string, options?: CallOptions): Promise<StepbackResult>;
export function fanout(query: string, options?: CallOptions): Promise<string>;
export function ragPipeline(query: string, options?: PipelineOptions): Promise<PipelineResult>;
export function rrf<T = string>(rankedLists: T[][], k?: number): string[];
export function setVectorClient(client: VectorStore | null): void;
export function callLLM(prompt: string, options?: CallOptions): Promise<string>;
export function getEmbedding(text: string, model?: string): Promise<number[]>;
export function setOpenAIClient(client: unknown): void;
