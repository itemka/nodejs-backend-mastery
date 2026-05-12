import { z } from 'zod';

export const DEFAULT_TOP_K = 5;
export const MAX_TOP_K = 20;

export const ingestRequestSchema = z
  .object({
    sourcePath: z.string().trim().min(1).optional(),
    strategy: z.enum(['sections', 'characters', 'sentences']).default('sections'),
  })
  .strict();

export const searchRequestSchema = z
  .object({
    query: z.string().trim().min(1).max(2000),
    topK: z.coerce.number().int().min(1).max(MAX_TOP_K).default(DEFAULT_TOP_K),
  })
  .strict();

export type IngestRequest = z.input<typeof ingestRequestSchema>;
export type SearchRequest = z.input<typeof searchRequestSchema>;

export interface IngestResponse {
  readonly chunkCount: number;
  readonly documentId: string;
  readonly indexSizes: { readonly bm25: number; readonly vector: number };
  readonly sourceName: string;
  readonly sourcePath: string;
  readonly strategy: 'characters' | 'sections' | 'sentences';
}

export interface SearchResponseChunk {
  readonly chunkId: string;
  readonly chunkIndex: number;
  readonly content: string;
  readonly documentId: string;
  readonly fusedScore: number;
  readonly lexicalRank?: number;
  readonly lexicalScore?: number;
  readonly sectionTitle?: string;
  readonly semanticRank?: number;
  readonly semanticScore?: number;
  readonly sourceName: string;
  readonly sourcePath: string;
}

export const EMPTY_INDEX_NOTE =
  'The document index is empty — no documents have been ingested yet.';

export interface SearchResponse {
  readonly indexEmpty?: boolean;
  readonly note?: string;
  readonly query: string;
  readonly results: readonly SearchResponseChunk[];
  readonly topK: number;
}

export interface HealthResponse {
  readonly embeddingModel: string;
  readonly indexed: { readonly chunks: number; readonly documents: number };
  readonly status: 'ok';
}

export interface ApiErrorPayload {
  readonly error: {
    readonly code: string;
    readonly details?: unknown;
    readonly message: string;
    readonly statusCode: number;
  };
}
