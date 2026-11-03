// Shared types for the vector store adapters
export interface StoreMatch {
  id: string;
  content: string;
  /** Higher is closer. null when the database reports no score */
  score: number | null;
  metadata: Record<string, unknown> | null;
}

/** The shape createRagforge({ vectorStore }) accepts */
export interface StoreAdapter {
  query(vector: number[], topK?: number): Promise<StoreMatch[]>;
  searchText?(text: string, topK?: number): Promise<StoreMatch[]>;
}
