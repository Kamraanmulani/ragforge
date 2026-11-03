// Chroma collection adapter. Pass your own client; ragforge does not import the database package.
import type { StoreAdapter } from "./types";
export type { StoreAdapter, StoreMatch } from "./types";

// Structural types: any client with these methods works
type PgClient = { query(text: string, params?: unknown[]): Promise<{ rows: any[] }> };
type QdrantClient = { query(collection: string, params: object): Promise<{ points: Array<{ id: string | number; score?: number; payload?: Record<string, unknown> | null }> }> };
type ChromaCollection = { query(params: { queryEmbeddings: number[][]; nResults: number }): Promise<any> };
type PineconeIndex = { query(params: object): Promise<{ matches?: Array<{ id: string; score?: number; metadata?: Record<string, unknown> }> }>; namespace?(name: string): PineconeIndex };
type LanceTable = { search(vector: number[]): { limit(n: number): { toArray(): Promise<any[]> } } };
type SupabaseClient = { rpc(fn: string, args: object): Promise<{ data: any[] | null; error: { message?: string } | null }> };

export function createChromaStore(options: { collection: ChromaCollection }): StoreAdapter;
