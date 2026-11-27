// ragforge/langchain: ragforge as a LangChain retriever, and LangChain retrievers in ragforge's eval.
// Needs @langchain/core. Types are structural so ragforge's types don't depend on LangChain's.
import type { Ragforge, EvalTechnique, ExternalRetriever } from "../../index";

export interface RagforgeRetrieverOptions {
  /** Passages per query (default: the config's topK, or 5) */
  topK?: number;
  /** Always use this technique instead of routing */
  technique?: EvalTechnique;
  /** Other BaseRetriever fields: tags, metadata, callbacks, verbose */
  fields?: Record<string, unknown>;
}

/** A LangChain document as the retriever returns it */
export interface RagforgeDocument {
  id?: string;
  pageContent: string;
  metadata: { id: string | null; ref: number; score: number | null; technique: string; [key: string]: unknown };
}

/** A @langchain/core BaseRetriever backed by ragforge */
export interface RagforgeLangChainRetriever {
  invoke(query: string, options?: unknown): Promise<RagforgeDocument[]>;
  lc_namespace: string[];
  [key: string]: unknown;
}

export function createRagforgeRetriever(rf: Ragforge, options?: RagforgeRetrieverOptions): RagforgeLangChainRetriever;

/** A LangChain retriever as a function rf.evaluate({ retrievers }) can score */
export function fromLangChainRetriever(retriever: { invoke(query: string): Promise<Array<{ id?: string; pageContent: string; metadata?: Record<string, unknown> }>> }): ExternalRetriever;
