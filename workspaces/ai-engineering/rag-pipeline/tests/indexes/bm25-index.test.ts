import { describe, expect, it } from 'vitest';

import { Bm25Index, tokenize } from '../../src/indexes/bm25-index.js';
import type { DocumentChunk } from '../../src/shared/types.js';

function makeChunk(id: string, content: string): DocumentChunk {
  return {
    chunkId: id,
    chunkIndex: 0,
    content,
    documentId: 'd',
    sourceName: 'doc.md',
    sourcePath: '/tmp/doc.md',
  };
}

describe('tokenize', () => {
  it('preserves identifier tokens like INC-2023-Q4-011', () => {
    const tokens = tokenize('Incident INC-2023-Q4-011 occurred during deploy.');

    expect(tokens).toContain('inc-2023-q4-011');
    expect(tokens).toContain('incident');
    expect(tokens).toContain('occurred');
  });

  it('returns an empty list for blank input', () => {
    expect(tokenize('   ')).toEqual([]);
  });
});

describe('Bm25Index', () => {
  it('finds an exact incident-id match', () => {
    const index = new Bm25Index();
    index.addMany([
      makeChunk('a', 'Incident INC-2023-Q4-011 hit the payment gateway after a deploy.'),
      makeChunk('b', 'Database vacuum job ran longer than expected on October 25.'),
      makeChunk('c', 'Customer communication included status page updates.'),
    ]);

    const hits = index.search('INC-2023-Q4-011', 5);

    expect(hits[0]?.chunk.chunkId).toBe('a');
    expect(hits[0]?.score).toBeGreaterThan(0);
  });

  it('returns empty results for empty queries or empty stores', () => {
    const empty = new Bm25Index();
    expect(empty.search('any', 5)).toEqual([]);

    const populated = new Bm25Index();
    populated.addOne(makeChunk('a', 'hello world'));
    expect(populated.search('   ', 5)).toEqual([]);
  });

  it('rejects invalid input chunks', () => {
    const index = new Bm25Index();
    expect(() => index.addOne(makeChunk('', 'something'))).toThrow(/chunkId/);
    expect(() => index.addOne(makeChunk('a', '   '))).toThrow(/content/);
  });

  it('rejects invalid topK', () => {
    const index = new Bm25Index();
    index.addOne(makeChunk('a', 'hello world'));

    expect(() => index.search('hello', 0)).toThrow(/positive integer/);
  });
});
