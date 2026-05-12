const DEFAULT_REQUEST_TIMEOUT_MS = 30_000;

export interface SearchDocsClientConfig {
  readonly baseUrl: string;
  readonly fetcher?: typeof fetch;
  readonly timeoutMs?: number;
}

export interface SearchDocsRequest {
  readonly query: string;
  readonly topK: number;
}

export interface SearchDocsResultChunk {
  readonly chunkId: string;
  readonly chunkIndex: number;
  readonly content: string;
  readonly documentId: string;
  readonly fusedScore: number;
  readonly sectionTitle?: string;
  readonly sourceName: string;
  readonly sourcePath: string;
}

export interface SearchDocsResponse {
  readonly indexEmpty?: boolean;
  readonly note?: string;
  readonly query: string;
  readonly results: readonly SearchDocsResultChunk[];
  readonly topK: number;
}

export interface SearchDocsClient {
  readonly search: (request: SearchDocsRequest) => Promise<SearchDocsResponse>;
}

export class SearchDocsClientError extends Error {
  public readonly statusCode?: number;

  public constructor(message: string, statusCode?: number) {
    super(message);
    this.name = 'SearchDocsClientError';

    if (statusCode !== undefined) {
      this.statusCode = statusCode;
    }
  }
}

function normalizeBaseUrl(baseUrl: string): string {
  const trimmed = baseUrl.trim();

  if (trimmed === '') {
    throw new SearchDocsClientError('RAG base URL must not be empty.');
  }

  let parsed: URL;

  try {
    parsed = new URL(trimmed);
  } catch {
    throw new SearchDocsClientError('RAG base URL must be a valid URL.');
  }

  if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') {
    throw new SearchDocsClientError('RAG base URL must use http or https.');
  }

  return parsed.toString().replace(/\/+$/, '');
}

function isResultChunk(value: unknown): value is SearchDocsResultChunk {
  if (value === null || typeof value !== 'object') {
    return false;
  }

  const record = value as Record<string, unknown>;

  return (
    typeof record.chunkId === 'string' &&
    typeof record.chunkIndex === 'number' &&
    typeof record.content === 'string' &&
    typeof record.documentId === 'string' &&
    typeof record.fusedScore === 'number' &&
    typeof record.sourceName === 'string' &&
    typeof record.sourcePath === 'string' &&
    (record.sectionTitle === undefined || typeof record.sectionTitle === 'string')
  );
}

function parseSearchResponse(payload: unknown): SearchDocsResponse {
  if (payload === null || typeof payload !== 'object') {
    throw new SearchDocsClientError('RAG search response was not an object.');
  }

  const record = payload as Record<string, unknown>;

  if (typeof record.query !== 'string' || typeof record.topK !== 'number') {
    throw new SearchDocsClientError('RAG search response is missing query or topK.');
  }

  if (!Array.isArray(record.results)) {
    throw new SearchDocsClientError('RAG search response results must be an array.');
  }

  for (const item of record.results) {
    if (!isResultChunk(item)) {
      throw new SearchDocsClientError('RAG search response contained a malformed result chunk.');
    }
  }

  if (record.indexEmpty !== undefined && typeof record.indexEmpty !== 'boolean') {
    throw new SearchDocsClientError('RAG search response indexEmpty must be a boolean.');
  }

  if (record.note !== undefined && typeof record.note !== 'string') {
    throw new SearchDocsClientError('RAG search response note must be a string.');
  }

  return {
    query: record.query,
    results: record.results,
    topK: record.topK,
    ...(record.indexEmpty === undefined ? {} : { indexEmpty: record.indexEmpty }),
    ...(record.note === undefined ? {} : { note: record.note }),
  };
}

export function createSearchDocsClient(config: SearchDocsClientConfig): SearchDocsClient {
  const baseUrl = normalizeBaseUrl(config.baseUrl);
  const fetcher = config.fetcher ?? fetch;
  const timeoutMs = config.timeoutMs ?? DEFAULT_REQUEST_TIMEOUT_MS;

  return {
    async search(request) {
      if (typeof request.query !== 'string' || request.query.trim() === '') {
        throw new SearchDocsClientError('query must be a non-empty string.');
      }

      if (!Number.isInteger(request.topK) || request.topK <= 0) {
        throw new SearchDocsClientError('topK must be a positive integer.');
      }

      const controller = new AbortController();
      const timeoutHandle = setTimeout(() => controller.abort(), timeoutMs);

      let response: Response;

      try {
        response = await fetcher(`${baseUrl}/search`, {
          body: JSON.stringify({ query: request.query.trim(), topK: request.topK }),
          headers: { 'content-type': 'application/json' },
          method: 'POST',
          signal: controller.signal,
        });
      } catch (error) {
        if (error instanceof Error && error.name === 'AbortError') {
          throw new SearchDocsClientError('RAG search request timed out.');
        }

        throw new SearchDocsClientError(
          error instanceof Error
            ? `RAG search request failed: ${error.message}`
            : 'RAG search request failed.',
        );
      } finally {
        clearTimeout(timeoutHandle);
      }

      const rawBody = await response.text();
      let parsed: unknown;

      if (rawBody.length > 0) {
        try {
          parsed = JSON.parse(rawBody);
        } catch {
          throw new SearchDocsClientError(
            `RAG search returned invalid JSON (status ${response.status}).`,
            response.status,
          );
        }
      }

      if (!response.ok) {
        throw new SearchDocsClientError(
          `RAG search returned status ${response.status}.`,
          response.status,
        );
      }

      return parseSearchResponse(parsed);
    },
  };
}
