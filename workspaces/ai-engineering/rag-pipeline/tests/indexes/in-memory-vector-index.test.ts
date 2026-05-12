import { describe, expect, it } from 'vitest';

import { InMemoryVectorIndex } from '../../src/indexes/in-memory-vector-index.js';
import type { EmbeddedChunk } from '../../src/shared/types.js';

function makeChunk(id: string, content: string, embedding: number[]): EmbeddedChunk {
  return {
    chunkId: id,
    chunkIndex: 0,
    content,
    documentId: 'd',
    embedding,
    sourceName: 'doc.md',
    sourcePath: '/tmp/doc.md',
  };
}

describe('InMemoryVectorIndex', () => {
  it('returns top-k results ordered by cosine similarity', () => {
    const index = new InMemoryVectorIndex();
    index.addOne(makeChunk('a', 'A', [1, 0]));
    index.addOne(makeChunk('b', 'B', [0, 1]));
    index.addOne(makeChunk('c', 'C', [1, 1]));

    const hits = index.search([1, 0], 2);

    expect(hits[0]?.chunk.chunkId).toBe('a');
    expect(hits[1]?.chunk.chunkId).toBe('c');
    expect(hits[0]?.rank).toBe(1);
    expect(hits[1]?.rank).toBe(2);
  });

  it('supports addMany', () => {
    const index = new InMemoryVectorIndex();
    index.addMany([makeChunk('a', 'A', [1, 0, 0]), makeChunk('b', 'B', [0, 1, 0])]);

    expect(index.size()).toBe(2);
  });

  it('counts distinct source documents', () => {
    const index = new InMemoryVectorIndex();
    index.addMany([
      makeChunk('a', 'A', [1, 0]),
      { ...makeChunk('b', 'B', [0, 1]), sourcePath: '/tmp/other.md' },
      { ...makeChunk('c', 'C', [1, 1]), sourcePath: '/tmp/other.md' },
    ]);

    expect(index.documentCount()).toBe(2);
  });

  it('rejects empty, non-finite, and dimension-mismatched vectors', () => {
    const index = new InMemoryVectorIndex();
    expect(() => index.addOne(makeChunk('a', 'A', []))).toThrow(/non-empty array/);
    expect(() => index.addOne(makeChunk('a', 'A', [Number.NaN]))).toThrow(/finite numbers/);

    index.addOne(makeChunk('a', 'A', [1, 2, 3]));
    expect(() => index.addOne(makeChunk('b', 'B', [1, 2]))).toThrow(/dimension mismatch/);
    expect(() => index.search([1, 2], 1)).toThrow(/dimension mismatch/);
  });

  it('returns empty results for an empty store', () => {
    const index = new InMemoryVectorIndex();

    expect(index.search([1, 0, 0], 5)).toEqual([]);
  });

  it('rejects invalid topK', () => {
    const index = new InMemoryVectorIndex();
    index.addOne(makeChunk('a', 'A', [1, 2]));

    expect(() => index.search([1, 2], 0)).toThrow(/positive integer/);
  });

  it('honors the configured dimension', () => {
    const index = new InMemoryVectorIndex({ dimensions: 3 });

    expect(() => index.addOne(makeChunk('a', 'A', [1, 2]))).toThrow(/dimension mismatch/);
  });
});
