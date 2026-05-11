export interface SentenceChunk {
  readonly content: string;
  readonly index: number;
}

const SENTENCE_BOUNDARY = /(?<=[!.?])\s+(?=[A-Z(\d[\]"'`])/;

export function splitIntoSentences(text: string): string[] {
  const trimmed = text.trim();

  if (trimmed === '') {
    return [];
  }

  return trimmed
    .split(SENTENCE_BOUNDARY)
    .map((sentence) => sentence.trim())
    .filter((sentence) => sentence !== '');
}

export function chunkBySentences(
  text: string,
  maxSentencesPerChunk: number,
  overlapSentences: number,
): SentenceChunk[] {
  if (!Number.isInteger(maxSentencesPerChunk) || maxSentencesPerChunk <= 0) {
    throw new RangeError('maxSentencesPerChunk must be a positive integer.');
  }

  if (!Number.isInteger(overlapSentences) || overlapSentences < 0) {
    throw new RangeError('overlapSentences must be a non-negative integer.');
  }

  if (overlapSentences >= maxSentencesPerChunk) {
    throw new RangeError('overlapSentences must be smaller than maxSentencesPerChunk.');
  }

  const sentences = splitIntoSentences(text);

  if (sentences.length === 0) {
    return [];
  }

  const stride = maxSentencesPerChunk - overlapSentences;
  const chunks: SentenceChunk[] = [];
  let cursor = 0;
  let index = 0;

  while (cursor < sentences.length) {
    const slice = sentences.slice(cursor, cursor + maxSentencesPerChunk);
    const content = slice.join(' ').trim();

    if (content !== '') {
      chunks.push({ content, index });
      index += 1;
    }

    if (cursor + maxSentencesPerChunk >= sentences.length) {
      break;
    }

    cursor += stride;
  }

  return chunks;
}
