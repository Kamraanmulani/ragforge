// ragforge/mastra: a Mastra tool that searches your documents with ragforge. Needs @mastra/core.
import type { Ragforge, EvalTechnique } from "../../index";

export interface RagforgeToolOptions {
  /** Tool id (default "search-docs") */
  id?: string;
  description?: string;
  topK?: number;
  /** Always use this technique instead of routing */
  technique?: EvalTechnique;
}

/** A Mastra Tool (pass it in an Agent's `tools`); it returns { passages, technique } */
export function createRagforgeTool(rf: Ragforge, options?: RagforgeToolOptions): any;
