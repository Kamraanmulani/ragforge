// ragforge/ai-sdk: ragforge as a Vercel AI SDK tool and middleware. Needs `ai`.
// Types are structural so ragforge's types don't depend on the AI SDK's.
import type { Ragforge, EvalTechnique, Source, Route, Stats } from "../../index";

export interface RagforgeToolOptions {
  /** What the model is told the tool does */
  description?: string;
  topK?: number;
  /** Always use this technique instead of routing */
  technique?: EvalTechnique;
}

export interface RagforgeToolOutput {
  passages: Array<{ ref: number; id: string | null; content: string; score: number | null }>;
  technique: string;
}

/** An AI SDK tool (pass it in `tools`); its output is RagforgeToolOutput */
export function createRagforgeTool(rf: Ragforge, options?: RagforgeToolOptions): any;

export interface RagforgeMiddlewareOptions {
  topK?: number;
  technique?: EvalTechnique;
  /** Text placed before the numbered passages in the system prompt */
  instructions?: string;
  /** Called with what was retrieved for each model call */
  onSources?: (info: { query: string; sources: Source[]; route: Route; stats: Stats }) => void;
}

/** A LanguageModelMiddleware (specificationVersion "v4") for wrapLanguageModel() */
export function createRagforgeMiddleware(
  rf: Ragforge,
  options?: RagforgeMiddlewareOptions
): { specificationVersion: "v4"; transformParams(options: { params: any; type?: string; model?: unknown }): Promise<any> };

/** The text of the last user message in an AI SDK prompt */
export function lastUserText(prompt: Array<{ role: string; content: unknown }>): string;
