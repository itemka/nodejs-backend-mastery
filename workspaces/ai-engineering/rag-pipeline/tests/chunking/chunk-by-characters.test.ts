import { describe, expect, it } from 'vitest';

import { chunkByCharacters } from '../../src/chunking/chunk-by-characters.js';

describe('chunkByCharacters', () => {
  it('splits with overlap and preserves all content within chunk size', () => {
    const text = 'abcdefghij';
    const chunks = chunkByCharacters(text, 4, 1);

    expect(chunks.map((chunk) => chunk.content)).toEqual(['abcd', 'defg', 'ghij']);
    expect(chunks.map((chunk) => chunk.index)).toEqual([0, 1, 2]);
  });

  it('returns a single chunk when text fits in chunkSize', () => {
    expect(chunkByCharacters('hello', 10, 0)).toEqual([{ content: 'hello', index: 0 }]);
  });

  it('returns an empty array for empty input', () => {
    expect(chunkByCharacters('   ', 10, 0)).toEqual([]);
    expect(chunkByCharacters('', 10, 0)).toEqual([]);
  });

  it('rejects invalid sizes', () => {
    expect(() => chunkByCharacters('abc', 0, 0)).toThrow(/positive integer/);
    expect(() => chunkByCharacters('abc', -2, 0)).toThrow(/positive integer/);
    expect(() => chunkByCharacters('abc', 4, -1)).toThrow(/non-negative integer/);
    expect(() => chunkByCharacters('abc', 4, 4)).toThrow(/smaller than chunkSize/);
  });
});
