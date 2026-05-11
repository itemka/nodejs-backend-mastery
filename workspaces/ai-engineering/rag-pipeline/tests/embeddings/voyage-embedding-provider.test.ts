import { describe, expect, it, vi } from 'vitest';

import { VoyageEmbeddingProvider } from '../../src/embeddings/voyage-embedding-provider.js';

function jsonResponse(payload: unknown, status = 200): Response {
  return Response.json(payload, { status });
}

describe('VoyageEmbeddingProvider', () => {
  it('rejects an empty API key', () => {
    expect(() => new VoyageEmbeddingProvider({ apiKey: '   ', model: 'voyage-3-large' })).toThrow(
      /apiKey/,
    );
  });

  it('returns no vectors for an empty input list without calling fetch', async () => {
    const fetcher = vi.fn();
    const provider = new VoyageEmbeddingProvider({
      apiKey: 'sk-test',
      fetcher,
      model: 'voyage-3-large',
    });

    expect(await provider.embedDocuments([])).toEqual([]);
    expect(fetcher).not.toHaveBeenCalled();
  });

  it('posts documents with input_type=document and orders vectors by index', async () => {
    const fetcher = vi.fn().mockResolvedValue(
      jsonResponse({
        data: [
          { embedding: [0, 1], index: 1 },
          { embedding: [1, 0], index: 0 },
        ],
      }),
    );
    const provider = new VoyageEmbeddingProvider({
      apiKey: 'sk-test',
      fetcher,
      model: 'voyage-3-large',
    });

    const vectors = await provider.embedDocuments(['first', 'second']);

    expect(vectors).toEqual([
      [1, 0],
      [0, 1],
    ]);

    const [, init] = fetcher.mock.calls[0] ?? [];
    expect(init).toMatchObject({
      headers: { authorization: 'Bearer sk-test', 'content-type': 'application/json' },
      method: 'POST',
    });
    expect(JSON.parse((init as { body: string }).body)).toEqual({
      input: ['first', 'second'],
      input_type: 'document',
      model: 'voyage-3-large',
    });
  });

  it('embeds queries with input_type=query and returns the single vector', async () => {
    const fetcher = vi
      .fn()
      .mockResolvedValue(jsonResponse({ data: [{ embedding: [0.5, 0.5], index: 0 }] }));
    const provider = new VoyageEmbeddingProvider({
      apiKey: 'sk-test',
      fetcher,
      model: 'voyage-3-large',
    });

    const vector = await provider.embedQuery('  hello  ');

    expect(vector).toEqual([0.5, 0.5]);

    const [, init] = fetcher.mock.calls[0] ?? [];
    expect(JSON.parse((init as { body: string }).body)).toEqual({
      input: ['hello'],
      input_type: 'query',
      model: 'voyage-3-large',
    });
  });

  it('rejects empty queries before calling fetch', async () => {
    const fetcher = vi.fn();
    const provider = new VoyageEmbeddingProvider({
      apiKey: 'sk-test',
      fetcher,
      model: 'voyage-3-large',
    });

    await expect(provider.embedQuery('   ')).rejects.toThrow(/empty/);
    expect(fetcher).not.toHaveBeenCalled();
  });

  it('wraps non-2xx responses as EMBEDDING_PROVIDER_ERROR', async () => {
    const fetcher = vi.fn().mockResolvedValue(jsonResponse({ detail: 'rate limited' }, 429));
    const provider = new VoyageEmbeddingProvider({
      apiKey: 'sk-test',
      fetcher,
      model: 'voyage-3-large',
    });

    await expect(provider.embedDocuments(['hi'])).rejects.toMatchObject({
      code: 'EMBEDDING_PROVIDER_ERROR',
      statusCode: 502,
    });
  });

  it('rejects responses with a mismatched embedding count', async () => {
    const fetcher = vi.fn().mockResolvedValue(jsonResponse({ data: [] }));
    const provider = new VoyageEmbeddingProvider({
      apiKey: 'sk-test',
      fetcher,
      model: 'voyage-3-large',
    });

    await expect(provider.embedDocuments(['a', 'b'])).rejects.toMatchObject({
      code: 'EMBEDDING_PROVIDER_ERROR',
    });
  });
});
