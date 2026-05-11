import { describe, expect, it } from 'vitest';

import { chunkBySentences, splitIntoSentences } from '../../src/chunking/chunk-by-sentences.js';

describe('splitIntoSentences', () => {
  it('splits at sentence boundaries while preserving punctuation', () => {
    expect(
      splitIntoSentences('The team rolled back. Customer impact was small. Latency recovered.'),
    ).toEqual(['The team rolled back.', 'Customer impact was small.', 'Latency recovered.']);
  });

  it('returns an empty list for blank input', () => {
    expect(splitIntoSentences('   ')).toEqual([]);
  });
});

describe('chunkBySentences', () => {
  it('groups sentences into chunks with overlap', () => {
    const text = 'A. B. C. D. E.';
    const chunks = chunkBySentences(text, 2, 1);

    expect(chunks.map((chunk) => chunk.content)).toEqual(['A. B.', 'B. C.', 'C. D.', 'D. E.']);
  });

  it('returns a single chunk when sentence count is within max', () => {
    const chunks = chunkBySentences('Only sentence.', 5, 0);

    expect(chunks).toEqual([{ content: 'Only sentence.', index: 0 }]);
  });

  it('rejects invalid limits', () => {
    expect(() => chunkBySentences('A.', 0, 0)).toThrow(/positive integer/);
    expect(() => chunkBySentences('A.', 3, -1)).toThrow(/non-negative integer/);
    expect(() => chunkBySentences('A.', 2, 2)).toThrow(/smaller than maxSentencesPerChunk/);
  });
});
