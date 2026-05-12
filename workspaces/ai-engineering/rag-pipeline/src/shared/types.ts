export interface DocumentChunk {
  readonly chunkId: string;
  readonly chunkIndex: number;
  readonly content: string;
  readonly documentId: string;
  readonly sectionTitle?: string;
  readonly sourceName: string;
  readonly sourcePath: string;
}

export interface EmbeddedChunk extends DocumentChunk {
  readonly embedding: readonly number[];
}

export interface VectorSearchHit {
  readonly chunk: DocumentChunk;
  readonly rank: number;
  readonly score: number;
}

export interface LexicalSearchHit {
  readonly chunk: DocumentChunk;
  readonly rank: number;
  readonly score: number;
}

export interface SearchResult {
  readonly chunk: DocumentChunk;
  readonly fusedScore: number;
  readonly lexicalRank?: number;
  readonly lexicalScore?: number;
  readonly semanticRank?: number;
  readonly semanticScore?: number;
}
