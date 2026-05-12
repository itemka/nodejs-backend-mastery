import type { LexicalSearchHit, SearchResult, VectorSearchHit } from '../shared/types.js';

export const DEFAULT_RRF_K = 60;

export interface ReciprocalRankFusionInput {
  readonly k?: number;
  readonly lexical: readonly LexicalSearchHit[];
  readonly semantic: readonly VectorSearchHit[];
  readonly topK: number;
}

export function reciprocalRankFusion(input: ReciprocalRankFusionInput): SearchResult[] {
  if (!Number.isInteger(input.topK) || input.topK <= 0) {
    throw new RangeError('topK must be a positive integer.');
  }

  const k = input.k ?? DEFAULT_RRF_K;

  if (!Number.isFinite(k) || k <= 0) {
    throw new RangeError('k must be a positive finite number.');
  }

  const merged = new Map<
    string,
    {
      chunkId: string;
      fusedScore: number;
      lexicalRank?: number;
      lexicalScore?: number;
      result: SearchResult;
      semanticRank?: number;
      semanticScore?: number;
    }
  >();
  const insertionOrder = new Map<string, number>();
  let order = 0;

  for (const hit of input.semantic) {
    const id = hit.chunk.chunkId;
    const existing = merged.get(id);
    const fused = 1 / (k + hit.rank);

    if (existing === undefined) {
      const entry: SearchResult = {
        chunk: hit.chunk,
        fusedScore: fused,
        semanticRank: hit.rank,
        semanticScore: hit.score,
      };
      merged.set(id, {
        chunkId: id,
        fusedScore: fused,
        result: entry,
        semanticRank: hit.rank,
        semanticScore: hit.score,
      });
      insertionOrder.set(id, order++);
      continue;
    }

    existing.fusedScore += fused;
    existing.semanticRank = hit.rank;
    existing.semanticScore = hit.score;
  }

  for (const hit of input.lexical) {
    const id = hit.chunk.chunkId;
    const existing = merged.get(id);
    const fused = 1 / (k + hit.rank);

    if (existing === undefined) {
      const entry: SearchResult = {
        chunk: hit.chunk,
        fusedScore: fused,
        lexicalRank: hit.rank,
        lexicalScore: hit.score,
      };
      merged.set(id, {
        chunkId: id,
        fusedScore: fused,
        lexicalRank: hit.rank,
        lexicalScore: hit.score,
        result: entry,
      });
      insertionOrder.set(id, order++);
      continue;
    }

    existing.fusedScore += fused;
    existing.lexicalRank = hit.rank;
    existing.lexicalScore = hit.score;
  }

  const fused: SearchResult[] = [];

  for (const entry of merged.values()) {
    fused.push({
      chunk: entry.result.chunk,
      fusedScore: entry.fusedScore,
      ...(entry.semanticRank === undefined ? {} : { semanticRank: entry.semanticRank }),
      ...(entry.semanticScore === undefined ? {} : { semanticScore: entry.semanticScore }),
      ...(entry.lexicalRank === undefined ? {} : { lexicalRank: entry.lexicalRank }),
      ...(entry.lexicalScore === undefined ? {} : { lexicalScore: entry.lexicalScore }),
    });
  }

  fused.sort((a, b) => {
    if (b.fusedScore !== a.fusedScore) {
      return b.fusedScore - a.fusedScore;
    }

    const orderA = insertionOrder.get(a.chunk.chunkId) ?? 0;
    const orderB = insertionOrder.get(b.chunk.chunkId) ?? 0;

    return orderA - orderB;
  });

  return fused.slice(0, input.topK);
}
