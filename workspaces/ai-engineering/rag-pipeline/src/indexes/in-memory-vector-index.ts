import type { DocumentChunk, EmbeddedChunk, VectorSearchHit } from '../shared/types.js';

export interface VectorIndexConfig {
  readonly dimensions?: number;
}

function isValidVector(vector: readonly number[]): boolean {
  if (vector.length === 0) {
    return false;
  }

  for (const value of vector) {
    if (!Number.isFinite(value)) {
      return false;
    }
  }

  return true;
}

function vectorMagnitude(vector: readonly number[]): number {
  let sum = 0;

  for (const value of vector) {
    sum += value * value;
  }

  return Math.sqrt(sum);
}

function cosineSimilarity(a: readonly number[], b: readonly number[]): number {
  if (a.length !== b.length) {
    return 0;
  }

  let dot = 0;

  for (const [index, value] of a.entries()) {
    const other = b[index];

    if (other === undefined) {
      continue;
    }

    dot += value * other;
  }

  const magnitude = vectorMagnitude(a) * vectorMagnitude(b);

  if (magnitude === 0) {
    return 0;
  }

  return dot / magnitude;
}

export class InMemoryVectorIndex {
  private dimensions: number | undefined;
  private readonly entries: { chunk: DocumentChunk; vector: readonly number[] }[] = [];

  public constructor(config: VectorIndexConfig = {}) {
    if (config.dimensions !== undefined) {
      if (!Number.isInteger(config.dimensions) || config.dimensions <= 0) {
        throw new RangeError('dimensions must be a positive integer when provided.');
      }

      this.dimensions = config.dimensions;
    }
  }

  public addOne(chunk: EmbeddedChunk): void {
    const vector = chunk.embedding;

    if (!isValidVector(vector)) {
      throw new TypeError('Embedding vector must be a non-empty array of finite numbers.');
    }

    if (this.dimensions === undefined) {
      this.dimensions = vector.length;
    } else if (vector.length !== this.dimensions) {
      throw new RangeError(
        `Embedding dimension mismatch: expected ${this.dimensions}, received ${vector.length}.`,
      );
    }

    const { embedding: _embedding, ...chunkMetadata } = chunk;
    this.entries.push({
      chunk: { ...chunkMetadata },
      vector: [...vector],
    });
  }

  public addMany(chunks: readonly EmbeddedChunk[]): void {
    for (const chunk of chunks) {
      this.addOne(chunk);
    }
  }

  public size(): number {
    return this.entries.length;
  }

  public search(queryVector: readonly number[], topK: number): VectorSearchHit[] {
    if (!Number.isInteger(topK) || topK <= 0) {
      throw new RangeError('topK must be a positive integer.');
    }

    if (!isValidVector(queryVector)) {
      throw new TypeError('queryVector must be a non-empty array of finite numbers.');
    }

    if (this.entries.length === 0) {
      return [];
    }

    if (this.dimensions !== undefined && queryVector.length !== this.dimensions) {
      throw new RangeError(
        `Query vector dimension mismatch: expected ${this.dimensions}, received ${queryVector.length}.`,
      );
    }

    const scored = this.entries.map((entry, position) => ({
      chunk: entry.chunk,
      position,
      score: cosineSimilarity(queryVector, entry.vector),
    }));

    scored.sort((a, b) => {
      if (b.score !== a.score) {
        return b.score - a.score;
      }

      return a.position - b.position;
    });

    return scored.slice(0, topK).map((entry, index) => ({
      chunk: entry.chunk,
      rank: index + 1,
      score: entry.score,
    }));
  }
}
