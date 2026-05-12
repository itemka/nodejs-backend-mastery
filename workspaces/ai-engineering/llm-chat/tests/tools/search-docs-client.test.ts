import { describe, expect, it, vi } from 'vitest';

import {
  SearchDocsClientError,
  createSearchDocsClient,
} from '../../src/tools/search-docs-client.js';

function jsonResponse(payload: unknown, status = 200): Response {
  return Response.json(payload, { status });
}

describe('createSearchDocsClient', () => {
  it('rejects invalid base URLs', () => {
    expect(() => createSearchDocsClient({ baseUrl: '' })).toThrow(SearchDocsClientError);
    expect(() => createSearchDocsClient({ baseUrl: 'not a url' })).toThrow(SearchDocsClientError);
    expect(() => createSearchDocsClient({ baseUrl: 'ftp://example.com' })).toThrow(/http or https/);
  });

  it('posts to /search and returns the parsed response', async () => {
    const fetcher = vi.fn().mockResolvedValue(
      jsonResponse({
        query: 'incident',
        results: [
          {
            chunkId: 'a#0',
            chunkIndex: 0,
            content: 'something happened',
            documentId: 'a',
            fusedScore: 0.9,
            sourceName: 'a.md',
            sourcePath: '/repo/a.md',
          },
        ],
        topK: 5,
      }),
    );
    const client = createSearchDocsClient({ baseUrl: 'http://127.0.0.1:4100/', fetcher });

    const response = await client.search({ query: 'incident', topK: 5 });

    expect(response.query).toBe('incident');
    expect(response.results).toHaveLength(1);
    expect(fetcher).toHaveBeenCalledWith(
      'http://127.0.0.1:4100/search',
      expect.objectContaining({
        body: JSON.stringify({ query: 'incident', topK: 5 }),
        method: 'POST',
      }),
    );
  });

  it('parses indexEmpty and note when the service flags an empty index', async () => {
    const fetcher = vi.fn().mockResolvedValue(
      jsonResponse({
        indexEmpty: true,
        note: 'The document index is empty.',
        query: 'incident',
        results: [],
        topK: 5,
      }),
    );
    const client = createSearchDocsClient({ baseUrl: 'http://localhost:4100', fetcher });

    const response = await client.search({ query: 'incident', topK: 5 });

    expect(response.indexEmpty).toBe(true);
    expect(response.note).toBe('The document index is empty.');
    expect(response.results).toEqual([]);
  });

  it('rejects responses where indexEmpty is not a boolean', async () => {
    const fetcher = vi.fn().mockResolvedValue(
      jsonResponse({
        indexEmpty: 'yes',
        query: 'q',
        results: [],
        topK: 1,
      }),
    );
    const client = createSearchDocsClient({ baseUrl: 'http://localhost:4100', fetcher });

    await expect(client.search({ query: 'q', topK: 1 })).rejects.toThrow(/indexEmpty/);
  });

  it('rejects empty queries and non-positive topK', async () => {
    const fetcher = vi.fn();
    const client = createSearchDocsClient({ baseUrl: 'http://localhost:4100', fetcher });

    await expect(client.search({ query: '   ', topK: 1 })).rejects.toThrow(SearchDocsClientError);
    await expect(client.search({ query: 'q', topK: 0 })).rejects.toThrow(SearchDocsClientError);
    expect(fetcher).not.toHaveBeenCalled();
  });

  it('throws SearchDocsClientError on non-2xx responses', async () => {
    const fetcher = vi
      .fn()
      .mockResolvedValue(
        Response.json(
          { error: { code: 'INTERNAL_SERVER_ERROR', message: 'boom' } },
          { status: 500 },
        ),
      );
    const client = createSearchDocsClient({ baseUrl: 'http://localhost:4100', fetcher });

    await expect(client.search({ query: 'q', topK: 1 })).rejects.toMatchObject({
      name: 'SearchDocsClientError',
      statusCode: 500,
    });
  });

  it('rejects malformed response bodies', async () => {
    const fetcher = vi.fn().mockResolvedValue(jsonResponse({ unexpected: true }));
    const client = createSearchDocsClient({ baseUrl: 'http://localhost:4100', fetcher });

    await expect(client.search({ query: 'q', topK: 1 })).rejects.toThrow(SearchDocsClientError);
  });

  it('wraps fetcher errors as SearchDocsClientError', async () => {
    const fetcher = vi.fn().mockRejectedValue(new Error('connection refused'));
    const client = createSearchDocsClient({ baseUrl: 'http://localhost:4100', fetcher });

    await expect(client.search({ query: 'q', topK: 1 })).rejects.toMatchObject({
      message: expect.stringContaining('connection refused'),
      name: 'SearchDocsClientError',
    });
  });
});
