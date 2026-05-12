import type { EmbeddingProvider } from '../embeddings/embedding-provider.js';
import type { Bm25Index } from '../indexes/bm25-index.js';
import type { InMemoryVectorIndex } from '../indexes/in-memory-vector-index.js';
import type { DocumentChunk, EmbeddedChunk, SearchResult } from '../shared/types.js';
import { DEFAULT_RRF_K, reciprocalRankFusion } from './rrf.js';

export interface RetrieverConfig {
  readonly bm25Index: Bm25Index;
  readonly embeddingProvider: EmbeddingProvider;
  readonly rrfK?: number;
  readonly vectorIndex: InMemoryVectorIndex;
}

export interface IngestChunksInput {
  readonly chunks: readonly DocumentChunk[];
}

export class Retriever {
  private readonly bm25Index: Bm25Index;
  private readonly embeddingProvider: EmbeddingProvider;
  private readonly rrfK: number;
  private readonly vectorIndex: InMemoryVectorIndex;

  public constructor(config: RetrieverConfig) {
    this.embeddingProvider = config.embeddingProvider;
    this.vectorIndex = config.vectorIndex;
    this.bm25Index = config.bm25Index;
    this.rrfK = config.rrfK ?? DEFAULT_RRF_K;
  }

  public async ingest(input: IngestChunksInput): Promise<EmbeddedChunk[]> {
    if (input.chunks.length === 0) {
      return [];
    }

    const texts = input.chunks.map((chunk) => chunk.content);
    const vectors = await this.embeddingProvider.embedDocuments(texts);

    if (vectors.length !== input.chunks.length) {
      throw new Error('Embedding provider returned a mismatched number of vectors.');
    }

    const embedded: EmbeddedChunk[] = input.chunks.map((chunk, index) => {
      const embedding = vectors[index];

      if (embedding === undefined) {
        throw new Error(`Missing embedding for chunk ${chunk.chunkId}.`);
      }

      return { ...chunk, embedding };
    });

    this.vectorIndex.addMany(embedded);
    this.bm25Index.addMany(input.chunks);

    return embedded;
  }

  public sizes(): { bm25: number; vector: number } {
    return {
      bm25: this.bm25Index.size(),
      vector: this.vectorIndex.size(),
    };
  }

  public documentCount(): number {
    return this.vectorIndex.documentCount();
  }

  public async search(query: string, topK: number): Promise<SearchResult[]> {
    if (!Number.isInteger(topK) || topK <= 0) {
      throw new RangeError('topK must be a positive integer.');
    }

    const trimmed = query.trim();

    if (trimmed === '') {
      return [];
    }

    const vectorPopulated = this.vectorIndex.size() > 0;
    const bm25Populated = this.bm25Index.size() > 0;

    if (!vectorPopulated && !bm25Populated) {
      return [];
    }

    const perIndexTopK = Math.max(topK * 2, topK);
    const semantic = vectorPopulated
      ? this.vectorIndex.search(await this.embeddingProvider.embedQuery(trimmed), perIndexTopK)
      : [];
    const lexical = bm25Populated ? this.bm25Index.search(trimmed, perIndexTopK) : [];

    return reciprocalRankFusion({ k: this.rrfK, lexical, semantic, topK });
  }
}
