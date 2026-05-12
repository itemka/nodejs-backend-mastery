import type { DocumentChunk, LexicalSearchHit } from '../shared/types.js';

export interface Bm25Config {
  readonly b?: number;
  readonly k1?: number;
}

const DEFAULT_K1 = 1.5;
const DEFAULT_B = 0.75;

const IDENTIFIER_PATTERN = /[a-z0-9][a-z0-9-]*[a-z0-9]/gi;
const ALPHANUMERIC_PATTERN = /[a-z0-9]+/gi;

function scanTokens(text: string): string[] {
  if (typeof text !== 'string' || text.trim() === '') {
    return [];
  }

  const lower = text.toLowerCase();
  const tokens: string[] = [];

  for (const match of lower.match(IDENTIFIER_PATTERN) ?? []) {
    if (match.length > 1) {
      tokens.push(match);
    }
  }

  for (const match of lower.match(ALPHANUMERIC_PATTERN) ?? []) {
    if (match.length > 1) {
      tokens.push(match);
    }
  }

  return tokens;
}

export function tokenize(text: string): string[] {
  return [...new Set(scanTokens(text))];
}

interface IndexedDoc {
  readonly chunk: DocumentChunk;
  readonly length: number;
  readonly termFrequencies: Map<string, number>;
}

export class Bm25Index {
  private readonly b: number;
  private readonly docs: IndexedDoc[] = [];
  private readonly documentFrequencies = new Map<string, number>();
  private readonly k1: number;
  private totalLength = 0;

  public constructor(config: Bm25Config = {}) {
    this.k1 = config.k1 ?? DEFAULT_K1;
    this.b = config.b ?? DEFAULT_B;
  }

  public addOne(chunk: DocumentChunk): void {
    if (
      chunk === null ||
      typeof chunk !== 'object' ||
      typeof chunk.content !== 'string' ||
      chunk.content.trim() === '' ||
      typeof chunk.chunkId !== 'string' ||
      chunk.chunkId.trim() === ''
    ) {
      throw new TypeError('chunk must include a non-empty content string and chunkId.');
    }

    const tokens = scanTokens(chunk.content);
    const termFrequencies = new Map<string, number>();

    for (const token of tokens) {
      const previous = termFrequencies.get(token) ?? 0;
      termFrequencies.set(token, previous + 1);

      if (previous === 0) {
        this.documentFrequencies.set(token, (this.documentFrequencies.get(token) ?? 0) + 1);
      }
    }

    this.totalLength += tokens.length;
    this.docs.push({ chunk, length: tokens.length, termFrequencies });
  }

  public addMany(chunks: readonly DocumentChunk[]): void {
    for (const chunk of chunks) {
      this.addOne(chunk);
    }
  }

  public size(): number {
    return this.docs.length;
  }

  public search(query: string, topK: number): LexicalSearchHit[] {
    if (!Number.isInteger(topK) || topK <= 0) {
      throw new RangeError('topK must be a positive integer.');
    }

    const trimmed = query.trim();

    if (trimmed === '' || this.docs.length === 0) {
      return [];
    }

    const queryTokens = tokenize(trimmed);

    if (queryTokens.length === 0) {
      return [];
    }

    const averageLength = this.totalLength / this.docs.length;
    const scored = this.docs.map((doc, position) => ({
      chunk: doc.chunk,
      position,
      score: this.score(queryTokens, doc, averageLength),
    }));

    const filtered = scored.filter((entry) => entry.score > 0);

    filtered.sort((a, b) => {
      if (b.score !== a.score) {
        return b.score - a.score;
      }

      return a.position - b.position;
    });

    return filtered.slice(0, topK).map((entry, index) => ({
      chunk: entry.chunk,
      rank: index + 1,
      score: entry.score,
    }));
  }

  private score(queryTokens: readonly string[], doc: IndexedDoc, averageLength: number): number {
    let total = 0;

    for (const token of queryTokens) {
      const tf = doc.termFrequencies.get(token);

      if (tf === undefined) {
        continue;
      }

      const df = this.documentFrequencies.get(token) ?? 0;
      const idf = Math.log(1 + (this.docs.length - df + 0.5) / (df + 0.5));
      const denominator =
        tf +
        this.k1 * (1 - this.b + (this.b * doc.length) / (averageLength === 0 ? 1 : averageLength));
      total += idf * ((tf * (this.k1 + 1)) / denominator);
    }

    return total;
  }
}
