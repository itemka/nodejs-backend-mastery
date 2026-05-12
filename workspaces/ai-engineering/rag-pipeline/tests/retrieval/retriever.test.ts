import { describe, expect, it } from 'vitest';

import { Bm25Index } from '../../src/indexes/bm25-index.js';
import { InMemoryVectorIndex } from '../../src/indexes/in-memory-vector-index.js';
import { Retriever } from '../../src/retrieval/retriever.js';
import type { DocumentChunk } from '../../src/shared/types.js';
import { FakeEmbeddingProvider } from '../embeddings/fake-embedding-provider.js';

function chunk(id: string, content: string): DocumentChunk {
  return {
    chunkId: id,
    chunkIndex: 0,
    content,
    documentId: 'd',
    sourceName: 'doc.md',
    sourcePath: '/tmp/doc.md',
  };
}

describe('Retriever', () => {
  it('embeds chunks, populates both indexes, and merges hybrid hits', async () => {
    const embeddingProvider = new FakeEmbeddingProvider();
    const retriever = new Retriever({
      bm25Index: new Bm25Index(),
      embeddingProvider,
      vectorIndex: new InMemoryVectorIndex(),
    });
    await retriever.ingest({
      chunks: [
        chunk('a', 'Incident INC-2023-Q4-011 hit the payment gateway after a deploy.'),
        chunk('b', 'Database vacuum job ran longer than expected on October 25.'),
        chunk('c', 'Customer communication included status page updates.'),
      ],
    });

    expect(retriever.sizes()).toEqual({ bm25: 3, vector: 3 });

    const results = await retriever.search('INC-2023-Q4-011 incident', 3);

    expect(results[0]?.chunk.chunkId).toBe('a');
    expect(results.map((result) => result.chunk.chunkId)).toContain('a');
    expect(embeddingProvider.embedQueryCalls).toEqual(['INC-2023-Q4-011 incident']);
  });

  it('lets a semantic-only match outrank lexical noise', async () => {
    const embeddingProvider = new FakeEmbeddingProvider();
    const retriever = new Retriever({
      bm25Index: new Bm25Index(),
      embeddingProvider,
      vectorIndex: new InMemoryVectorIndex(),
    });
    await retriever.ingest({
      chunks: [
        chunk('a', 'A database maintenance window paused background jobs.'),
        chunk('b', 'Customer status updates were published twice.'),
      ],
    });

    const results = await retriever.search('database maintenance', 5);

    expect(results[0]?.chunk.chunkId).toBe('a');
  });

  it('returns no results for an empty query', async () => {
    const retriever = new Retriever({
      bm25Index: new Bm25Index(),
      embeddingProvider: new FakeEmbeddingProvider(),
      vectorIndex: new InMemoryVectorIndex(),
    });

    expect(await retriever.search('   ', 3)).toEqual([]);
  });

  it('returns no results and skips the embedding call when both indexes are empty', async () => {
    const embeddingProvider = new FakeEmbeddingProvider();
    const retriever = new Retriever({
      bm25Index: new Bm25Index(),
      embeddingProvider,
      vectorIndex: new InMemoryVectorIndex(),
    });

    expect(await retriever.search('anything', 3)).toEqual([]);
    expect(embeddingProvider.embedQueryCalls).toEqual([]);
  });

  it('skips the embedding call when only the vector index is empty', async () => {
    const embeddingProvider = new FakeEmbeddingProvider();
    const bm25Index = new Bm25Index();
    bm25Index.addOne(chunk('a', 'INC-2023-Q4-011 happened on October 12.'));
    const retriever = new Retriever({
      bm25Index,
      embeddingProvider,
      vectorIndex: new InMemoryVectorIndex(),
    });

    const results = await retriever.search('INC-2023-Q4-011', 3);

    expect(results.map((result) => result.chunk.chunkId)).toEqual(['a']);
    expect(embeddingProvider.embedQueryCalls).toEqual([]);
  });
});
