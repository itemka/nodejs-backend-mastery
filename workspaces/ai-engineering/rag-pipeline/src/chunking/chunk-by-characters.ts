export interface CharacterChunk {
  readonly content: string;
  readonly index: number;
}

export function chunkByCharacters(
  text: string,
  chunkSize: number,
  chunkOverlap: number,
): CharacterChunk[] {
  if (!Number.isInteger(chunkSize) || chunkSize <= 0) {
    throw new RangeError('chunkSize must be a positive integer.');
  }

  if (!Number.isInteger(chunkOverlap) || chunkOverlap < 0) {
    throw new RangeError('chunkOverlap must be a non-negative integer.');
  }

  if (chunkOverlap >= chunkSize) {
    throw new RangeError('chunkOverlap must be smaller than chunkSize.');
  }

  const trimmed = text.trim();

  if (trimmed === '') {
    return [];
  }

  const stride = chunkSize - chunkOverlap;
  const chunks: CharacterChunk[] = [];
  let cursor = 0;
  let index = 0;

  while (cursor < trimmed.length) {
    const slice = trimmed.slice(cursor, cursor + chunkSize);
    const content = slice.trim();

    if (content !== '') {
      chunks.push({ content, index });
      index += 1;
    }

    if (cursor + chunkSize >= trimmed.length) {
      break;
    }

    cursor += stride;
  }

  return chunks;
}
