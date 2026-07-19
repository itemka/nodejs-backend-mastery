import { describe, expect, it } from 'vitest';

import { reciprocalRankFusion } from '../../src/retrieval/rrf.js';
import type { DocumentChunk, LexicalSearchHit, VectorSearchHit } from '../../src/shared/types.js';

function makeChunk(id: string): DocumentChunk {
  return {
    chunkId: id,
    chunkIndex: 0,
    content: id,
    documentId: 'd',
    sourceName: 'doc.md',
    sourcePath: '/tmp/doc.md',
  };
}

describe('reciprocalRankFusion', () => {
  it('boosts items that appear in both indexes and dedupes by chunkId', () => {
    const semantic: VectorSearchHit[] = [
      { chunk: makeChunk('a'), rank: 1, score: 0.9 },
      { chunk: makeChunk('b'), rank: 2, score: 0.7 },
    ];
    const lexical: LexicalSearchHit[] = [
      { chunk: makeChunk('b'), rank: 1, score: 5 },
      { chunk: makeChunk('c'), rank: 2, score: 3 },
    ];

    const fused = reciprocalRankFusion({ k: 1, lexical, semantic, topK: 5 });

    expect(fused).toHaveLength(3);
    expect(fused[0]?.chunk.chunkId).toBe('b');
    expect(fused[0]?.semanticRank).toBe(2);
    expect(fused[0]?.lexicalRank).toBe(1);
  });

  it('respects the configured topK', () => {
    const semantic: VectorSearchHit[] = [
      { chunk: makeChunk('a'), rank: 1, score: 0.9 },
      { chunk: makeChunk('b'), rank: 2, score: 0.7 },
    ];
    const fused = reciprocalRankFusion({ lexical: [], semantic, topK: 1 });

    expect(fused).toHaveLength(1);
    expect(fused[0]?.chunk.chunkId).toBe('a');
  });

  it('rejects invalid topK or k', () => {
    expect(() => reciprocalRankFusion({ lexical: [], semantic: [], topK: 0 })).toThrow(
      /positive integer/,
    );
    expect(() => reciprocalRankFusion({ k: -1, lexical: [], semantic: [], topK: 5 })).toThrow(
      /positive finite/,
    );
    // k must be strictly positive: 0 is the boundary between "finite but non-positive" and valid.
    expect(() => reciprocalRankFusion({ k: 0, lexical: [], semantic: [], topK: 5 })).toThrow(
      /positive finite/,
    );
  });

  it('keeps the matching index score/rank keys and omits the other index for single-index chunks', () => {
    const semantic: VectorSearchHit[] = [
      { chunk: makeChunk('semantic-only'), rank: 1, score: 0.9 },
    ];
    const lexical: LexicalSearchHit[] = [{ chunk: makeChunk('lexical-only'), rank: 1, score: 5 }];

    const fused = reciprocalRankFusion({ k: 1, lexical, semantic, topK: 5 });
    const semanticOnly = fused.find((result) => result.chunk.chunkId === 'semantic-only');
    const lexicalOnly = fused.find((result) => result.chunk.chunkId === 'lexical-only');

    expect(semanticOnly?.semanticRank).toBe(1);
    expect(semanticOnly?.semanticScore).toBe(0.9);
    expect(lexicalOnly?.lexicalRank).toBe(1);
    expect(lexicalOnly?.lexicalScore).toBe(5);

    // Use hasOwn, not `.toBeUndefined()`: a spread that includes `{ key: undefined }` would
    // pass a `.toBeUndefined()` check while still adding an (undesired) own key to the object.
    expect(semanticOnly && Object.hasOwn(semanticOnly, 'lexicalRank')).toBe(false);
    expect(semanticOnly && Object.hasOwn(semanticOnly, 'lexicalScore')).toBe(false);
    expect(lexicalOnly && Object.hasOwn(lexicalOnly, 'semanticRank')).toBe(false);
    expect(lexicalOnly && Object.hasOwn(lexicalOnly, 'semanticScore')).toBe(false);
  });

  it('sums 1/(k+rank) across indexes and breaks equal-score ties by first-seen order', () => {
    const semantic: VectorSearchHit[] = [{ chunk: makeChunk('a'), rank: 2, score: 0.9 }];
    const lexical: LexicalSearchHit[] = [{ chunk: makeChunk('a'), rank: 3, score: 5 }];

    const fused = reciprocalRankFusion({ k: 10, lexical, semantic, topK: 5 });
    expect(fused[0]?.fusedScore).toBeCloseTo(1 / (10 + 2) + 1 / (10 + 3));

    // Four chunks with identical rank -> identical fusedScore within each index; the fusion
    // must preserve the order each chunk was first encountered rather than reorder ties.
    const tiedSemantic: VectorSearchHit[] = [
      { chunk: makeChunk('semantic-first'), rank: 5, score: 1 },
      { chunk: makeChunk('semantic-second'), rank: 5, score: 1 },
    ];
    const tiedLexical: LexicalSearchHit[] = [
      { chunk: makeChunk('lexical-first'), rank: 5, score: 1 },
      { chunk: makeChunk('lexical-second'), rank: 5, score: 1 },
    ];

    const tied = reciprocalRankFusion({
      lexical: tiedLexical,
      semantic: tiedSemantic,
      topK: 10,
    });

    expect(tied.map((result) => result.chunk.chunkId)).toEqual([
      'semantic-first',
      'semantic-second',
      'lexical-first',
      'lexical-second',
    ]);
  });
});
