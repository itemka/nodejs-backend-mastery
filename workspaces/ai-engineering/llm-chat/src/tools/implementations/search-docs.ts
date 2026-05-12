import type { SearchDocsResultChunk } from '../search-docs-client.js';
import type { AppTool } from '../types.js';

export const SEARCH_DOCS_DEFAULT_TOP_K = 5;
export const SEARCH_DOCS_MAX_TOP_K = 10;
export const SEARCH_DOCS_CONTENT_TRUNCATION = 1200;

interface SearchDocsInput {
  readonly query: string;
  readonly topK: number;
}

function parseInput(input: unknown): SearchDocsInput {
  if (input === null || typeof input !== 'object') {
    throw new TypeError('input must be an object.');
  }

  const value = input as Record<string, unknown>;

  if (typeof value.query !== 'string' || value.query.trim() === '') {
    throw new TypeError('query must be a non-empty string.');
  }

  let topK = SEARCH_DOCS_DEFAULT_TOP_K;

  if (value.topK !== undefined) {
    if (typeof value.topK !== 'number' || !Number.isInteger(value.topK) || value.topK <= 0) {
      throw new TypeError('topK must be a positive integer when provided.');
    }

    topK = Math.min(value.topK, SEARCH_DOCS_MAX_TOP_K);
  }

  return {
    query: value.query.trim(),
    topK,
  };
}

function truncateContent(content: string): string {
  if (content.length <= SEARCH_DOCS_CONTENT_TRUNCATION) {
    return content;
  }

  return `${content.slice(0, SEARCH_DOCS_CONTENT_TRUNCATION - 3)}...`;
}

function compactChunk(chunk: SearchDocsResultChunk): Record<string, unknown> {
  return {
    chunkId: chunk.chunkId,
    chunkIndex: chunk.chunkIndex,
    content: truncateContent(chunk.content),
    documentId: chunk.documentId,
    score: chunk.fusedScore,
    ...(chunk.sectionTitle === undefined ? {} : { sectionTitle: chunk.sectionTitle }),
    sourceName: chunk.sourceName,
    sourcePath: chunk.sourcePath,
  };
}

export const searchDocsTool: AppTool = {
  definition: {
    description:
      'Search the configured RAG document index for chunks relevant to a user question. Returns the top matching chunks with source metadata so an answer can cite them.',
    inputSchema: {
      additionalProperties: false,
      properties: {
        query: {
          description: 'Natural-language search query.',
          type: 'string',
        },
        topK: {
          description: `Optional maximum number of chunks to return (default ${SEARCH_DOCS_DEFAULT_TOP_K}, capped at ${SEARCH_DOCS_MAX_TOP_K}).`,
          maximum: SEARCH_DOCS_MAX_TOP_K,
          minimum: 1,
          type: 'integer',
        },
      },
      required: ['query'],
      type: 'object',
    },
    name: 'search_docs',
  },
  async execute(input, context) {
    const parsed = parseInput(input);
    const client = context.searchDocsClient;

    if (client === undefined) {
      throw new Error(
        'search_docs is not configured. Pass --rag-base-url or set RAG_PIPELINE_BASE_URL.',
      );
    }

    const response = await client.search({ query: parsed.query, topK: parsed.topK });

    return {
      query: response.query,
      results: response.results.map((chunk) => compactChunk(chunk)),
      topK: response.topK,
      ...(response.indexEmpty === undefined ? {} : { indexEmpty: response.indexEmpty }),
      ...(response.note === undefined ? {} : { note: response.note }),
    };
  },
};
