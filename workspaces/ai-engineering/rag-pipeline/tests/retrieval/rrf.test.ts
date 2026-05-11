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
  });
});
