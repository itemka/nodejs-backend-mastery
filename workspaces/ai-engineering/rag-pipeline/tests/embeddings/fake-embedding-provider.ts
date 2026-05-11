import type { EmbeddingProvider } from '../../src/embeddings/embedding-provider.js';

const KEYWORDS: readonly { keyword: string; vector: readonly number[] }[] = [
  { keyword: 'incident', vector: [1, 0, 0, 0] },
  { keyword: 'database', vector: [0, 1, 0, 0] },
  { keyword: 'customer', vector: [0, 0, 1, 0] },
  { keyword: 'rag', vector: [0, 0, 0, 1] },
];

const DIMENSIONS = 4;

export function deterministicEmbedding(text: string): number[] {
  const lower = text.toLowerCase();
  const vector: number[] = Array.from<number>({ length: DIMENSIONS }).fill(0);
  let matched = false;

  for (const [index, entry] of KEYWORDS.entries()) {
    if (lower.includes(entry.keyword)) {
      vector[index] = 1;
      matched = true;
    }
  }

  if (!matched) {
    vector[DIMENSIONS - 1] = 0.0001;
  }

  return vector;
}

export class FakeEmbeddingProvider implements EmbeddingProvider {
  public readonly modelName = 'fake-keyword-embedder';
  public readonly embedDocumentsCalls: string[][] = [];
  public readonly embedQueryCalls: string[] = [];

  public embedDocuments(texts: readonly string[]): Promise<number[][]> {
    this.embedDocumentsCalls.push([...texts]);

    return Promise.resolve(texts.map((text) => deterministicEmbedding(text)));
  }

  public embedQuery(text: string): Promise<number[]> {
    this.embedQueryCalls.push(text);

    return Promise.resolve(deterministicEmbedding(text));
  }
}
