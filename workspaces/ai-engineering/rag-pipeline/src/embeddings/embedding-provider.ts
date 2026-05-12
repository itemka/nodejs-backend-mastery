export type EmbeddingInputType = 'document' | 'query';

export interface EmbeddingProvider {
  readonly modelName: string;
  embedDocuments(texts: readonly string[]): Promise<number[][]>;
  embedQuery(text: string): Promise<number[]>;
}
