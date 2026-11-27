// ragforge/llamaindex: ragforge as a LlamaIndex.TS retriever, and LlamaIndex retrievers in
// ragforge's eval. Needs @llamaindex/core. Types are structural.
import type { Ragforge, EvalTechnique, ExternalRetriever } from "../../index";

export interface RagforgeRetrieverOptions {
  topK?: number;
  /** Always use this technique instead of routing */
  technique?: EvalTechnique;
}

/** A @llamaindex/core BaseRetriever backed by ragforge */
export interface RagforgeLlamaIndexRetriever {
  retrieve(params: string | { query: unknown }): Promise<Array<{ node: { id_: string; getContent(mode?: string): string; metadata: Record<string, unknown> }; score?: number }>>;
  [key: string]: unknown;
}

export function createRagforgeRetriever(rf: Ragforge, options?: RagforgeRetrieverOptions): RagforgeLlamaIndexRetriever;

/** A LlamaIndex retriever as a function rf.evaluate({ retrievers }) can score */
export function fromLlamaIndexRetriever(retriever: { retrieve(params: { query: string }): Promise<Array<{ node: any; score?: number }>> }): ExternalRetriever;

/** The text of a LlamaIndex query (a string or message content parts) */
export function queryText(query: unknown): string;
