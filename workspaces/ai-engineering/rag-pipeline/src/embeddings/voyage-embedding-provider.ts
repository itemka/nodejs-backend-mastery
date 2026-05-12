import { HttpError } from '@workspaces/packages/errors';

import type { EmbeddingProvider } from './embedding-provider.js';

export const DEFAULT_VOYAGE_API_URL = 'https://api.voyageai.com/v1/embeddings';
const DEFAULT_REQUEST_TIMEOUT_MS = 60_000;

export interface VoyageEmbeddingProviderConfig {
  readonly apiKey: string;
  readonly apiUrl?: string;
  readonly fetcher?: typeof fetch;
  readonly model: string;
  readonly timeoutMs?: number;
}

interface EmbedResponseData {
  embedding?: number[];
  index?: number;
}

interface EmbedResponseShape {
  data?: EmbedResponseData[];
}

function extractVectors(response: EmbedResponseShape, expectedCount: number): number[][] {
  const items = Array.isArray(response.data) ? response.data : [];

  if (items.length !== expectedCount) {
    throw new HttpError({
      code: 'EMBEDDING_PROVIDER_ERROR',
      message: 'VoyageAI returned an unexpected number of embeddings.',
      statusCode: 502,
    });
  }

  const vectors: number[][] = Array.from({ length: expectedCount }, () => []);

  for (const [position, item] of items.entries()) {
    const embedding = item.embedding;

    if (!Array.isArray(embedding) || embedding.length === 0) {
      throw new HttpError({
        code: 'EMBEDDING_PROVIDER_ERROR',
        message: 'VoyageAI returned an empty embedding vector.',
        statusCode: 502,
      });
    }

    const idx = typeof item.index === 'number' ? item.index : position;

    if (idx < 0 || idx >= expectedCount) {
      throw new HttpError({
        code: 'EMBEDDING_PROVIDER_ERROR',
        message: 'VoyageAI returned an embedding with an out-of-range index.',
        statusCode: 502,
      });
    }

    vectors[idx] = embedding;
  }

  for (const vector of vectors) {
    if (vector.length === 0) {
      throw new HttpError({
        code: 'EMBEDDING_PROVIDER_ERROR',
        message: 'VoyageAI response is missing one or more embeddings.',
        statusCode: 502,
      });
    }
  }

  return vectors;
}

export class VoyageEmbeddingProvider implements EmbeddingProvider {
  public readonly modelName: string;
  private readonly apiKey: string;
  private readonly apiUrl: string;
  private readonly fetcher: typeof fetch;
  private readonly timeoutMs: number;

  public constructor(config: VoyageEmbeddingProviderConfig) {
    if (config.apiKey.trim() === '') {
      throw new HttpError({
        code: 'EMBEDDING_PROVIDER_ERROR',
        message: 'VoyageAI apiKey must not be empty.',
        statusCode: 500,
      });
    }

    this.modelName = config.model;
    this.apiKey = config.apiKey;
    this.apiUrl = config.apiUrl ?? DEFAULT_VOYAGE_API_URL;
    this.fetcher = config.fetcher ?? fetch;
    this.timeoutMs = config.timeoutMs ?? DEFAULT_REQUEST_TIMEOUT_MS;
  }

  public async embedDocuments(texts: readonly string[]): Promise<number[][]> {
    if (texts.length === 0) {
      return [];
    }

    const response = await this.embed([...texts], 'document');

    return extractVectors(response, texts.length);
  }

  public async embedQuery(text: string): Promise<number[]> {
    const trimmed = text.trim();

    if (trimmed === '') {
      throw new HttpError({
        code: 'INVALID_QUERY',
        message: 'Embedding query must not be empty.',
        statusCode: 400,
      });
    }

    const response = await this.embed([trimmed], 'query');
    const [vector] = extractVectors(response, 1);

    if (vector === undefined) {
      throw new HttpError({
        code: 'EMBEDDING_PROVIDER_ERROR',
        message: 'VoyageAI did not return a query embedding.',
        statusCode: 502,
      });
    }

    return vector;
  }

  private async embed(
    input: readonly string[],
    inputType: 'document' | 'query',
  ): Promise<EmbedResponseShape> {
    const controller = new AbortController();
    const timeoutHandle = setTimeout(() => controller.abort(), this.timeoutMs);

    let response: Response;

    try {
      response = await this.fetcher(this.apiUrl, {
        body: JSON.stringify({ input, input_type: inputType, model: this.modelName }),
        headers: {
          authorization: `Bearer ${this.apiKey}`,
          'content-type': 'application/json',
        },
        method: 'POST',
        signal: controller.signal,
      });
    } catch (error) {
      if (error instanceof Error && error.name === 'AbortError') {
        throw new HttpError({
          code: 'EMBEDDING_PROVIDER_TIMEOUT',
          message: 'VoyageAI embedding request timed out.',
          statusCode: 504,
        });
      }

      throw new HttpError({
        cause: error,
        code: 'EMBEDDING_PROVIDER_ERROR',
        message:
          error instanceof Error
            ? `VoyageAI embedding request failed: ${error.message}`
            : 'VoyageAI embedding request failed.',
        statusCode: 502,
      });
    } finally {
      clearTimeout(timeoutHandle);
    }

    const rawBody = await response.text();
    let parsed: unknown;

    if (rawBody.length > 0) {
      try {
        parsed = JSON.parse(rawBody);
      } catch {
        throw new HttpError({
          code: 'EMBEDDING_PROVIDER_ERROR',
          message: `VoyageAI returned invalid JSON (status ${response.status}).`,
          statusCode: 502,
        });
      }
    }

    if (!response.ok) {
      throw new HttpError({
        code: 'EMBEDDING_PROVIDER_ERROR',
        details: parsed,
        message: `VoyageAI embedding request returned status ${response.status}.`,
        statusCode: 502,
      });
    }

    if (parsed === null || typeof parsed !== 'object') {
      throw new HttpError({
        code: 'EMBEDDING_PROVIDER_ERROR',
        message: 'VoyageAI embedding response was not a JSON object.',
        statusCode: 502,
      });
    }

    return parsed as EmbedResponseShape;
  }
}
