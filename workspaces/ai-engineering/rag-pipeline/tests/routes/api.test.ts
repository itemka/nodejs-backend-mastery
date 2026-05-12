import type { AddressInfo } from 'node:net';
import path from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';

import { createApp } from '../../src/app.js';
import type { AppEnv } from '../../src/config/env.js';
import { FakeEmbeddingProvider } from '../embeddings/fake-embedding-provider.js';

const fixturesRoot = path.resolve(import.meta.dirname, '..', 'fixtures');

const TEST_ENV: AppEnv = {
  HOST: '127.0.0.1',
  NODE_ENV: 'test',
  PORT: 0,
  REQUEST_TIMEOUT_MS: 60_000,
  VOYAGE_API_KEY: 'unused',
  VOYAGE_EMBEDDING_MODEL: 'fake',
};

interface BootedApp {
  baseUrl: string;
  close: () => Promise<void>;
}

function noopLog(): void {
  // intentionally empty
}

function closeServer(server: { close: (cb?: (error?: Error) => void) => void }): Promise<void> {
  return new Promise((resolve, reject) => {
    server.close((error) => {
      if (error) {
        reject(error);

        return;
      }

      resolve();
    });
  });
}

async function bootApp(): Promise<BootedApp> {
  const { app } = createApp({
    allowedDocumentRoot: fixturesRoot,
    embeddingProvider: new FakeEmbeddingProvider(),
    env: TEST_ENV,
    logger: { error: noopLog, info: noopLog, warn: noopLog },
  });

  return new Promise((resolve, reject) => {
    const server = app.listen(0, '127.0.0.1');

    server.once('listening', () => {
      const address = server.address() as AddressInfo;
      resolve({
        baseUrl: `http://127.0.0.1:${address.port}`,
        close: () => closeServer(server),
      });
    });

    server.once('error', reject);
  });
}

describe('rag-pipeline API', () => {
  let booted: BootedApp | undefined;

  afterEach(async () => {
    if (booted) {
      await booted.close();
      booted = undefined;
    }
  });

  it('responds to /health', async () => {
    booted = await bootApp();

    const response = await fetch(`${booted.baseUrl}/health`);
    const json = (await response.json()) as Record<string, unknown>;

    expect(response.status).toBe(200);
    expect(json).toMatchObject({
      embeddingModel: 'fake',
      indexed: { chunks: 0, documents: 0 },
      status: 'ok',
    });
  });

  it('ingests a fixture document and returns search results', async () => {
    booted = await bootApp();

    const ingestResponse = await fetch(`${booted.baseUrl}/ingest`, {
      body: JSON.stringify({ sourcePath: 'sample-report.md' }),
      headers: { 'content-type': 'application/json' },
      method: 'POST',
    });

    expect(ingestResponse.status).toBe(200);

    const ingestJson = (await ingestResponse.json()) as Record<string, unknown>;
    expect(ingestJson).toMatchObject({
      documentId: 'sample-report',
      sourceName: 'sample-report.md',
      strategy: 'sections',
    });
    expect(typeof ingestJson.chunkCount).toBe('number');
    expect((ingestJson.chunkCount as number) > 0).toBe(true);

    const searchResponse = await fetch(`${booted.baseUrl}/search`, {
      body: JSON.stringify({ query: 'INC-2023-Q4-011 incident', topK: 3 }),
      headers: { 'content-type': 'application/json' },
      method: 'POST',
    });

    expect(searchResponse.status).toBe(200);

    const searchJson = (await searchResponse.json()) as {
      query: string;
      results: {
        chunkId: string;
        content: string;
      }[];
      topK: number;
    };
    expect(searchJson.topK).toBe(3);
    expect(searchJson.results.length).toBeGreaterThan(0);
    expect(searchJson.results.some((result) => result.content.includes('INC-2023-Q4-011'))).toBe(
      true,
    );
  });

  it('ingests the default report.md when no sourcePath is provided', async () => {
    booted = await bootApp();

    const ingestResponse = await fetch(`${booted.baseUrl}/ingest`, {
      body: JSON.stringify({}),
      headers: { 'content-type': 'application/json' },
      method: 'POST',
    });

    expect(ingestResponse.status).toBe(200);

    const ingestJson = (await ingestResponse.json()) as {
      chunkCount: number;
      documentId: string;
      sourceName: string;
      strategy: string;
    };
    expect(ingestJson).toMatchObject({
      documentId: 'report',
      sourceName: 'report.md',
      strategy: 'sections',
    });
    expect(ingestJson.chunkCount).toBeGreaterThan(0);
  });

  it('reports the distinct ingested document count in /health', async () => {
    booted = await bootApp();

    for (const sourcePath of ['sample-report.md', 'report.md']) {
      const ingestResponse = await fetch(`${booted.baseUrl}/ingest`, {
        body: JSON.stringify({ sourcePath }),
        headers: { 'content-type': 'application/json' },
        method: 'POST',
      });
      expect(ingestResponse.status).toBe(200);
    }

    const response = await fetch(`${booted.baseUrl}/health`);
    const json = (await response.json()) as {
      indexed: { chunks: number; documents: number };
    };

    expect(response.status).toBe(200);
    expect(json.indexed.documents).toBe(2);
    expect(json.indexed.chunks).toBeGreaterThan(2);
  });

  it('flags an empty-index /search response with indexEmpty and a note', async () => {
    booted = await bootApp();

    const response = await fetch(`${booted.baseUrl}/search`, {
      body: JSON.stringify({ query: 'INC-2023-Q4-011', topK: 3 }),
      headers: { 'content-type': 'application/json' },
      method: 'POST',
    });

    expect(response.status).toBe(200);

    const json = (await response.json()) as {
      indexEmpty?: boolean;
      note?: string;
      results: unknown[];
    };
    expect(json.results).toEqual([]);
    expect(json.indexEmpty).toBe(true);
    expect(typeof json.note).toBe('string');
    expect(json.note).toMatch(/empty/i);
  });

  it('omits indexEmpty after a document has been ingested', async () => {
    booted = await bootApp();

    const ingestResponse = await fetch(`${booted.baseUrl}/ingest`, {
      body: JSON.stringify({ sourcePath: 'sample-report.md' }),
      headers: { 'content-type': 'application/json' },
      method: 'POST',
    });
    expect(ingestResponse.status).toBe(200);

    const searchResponse = await fetch(`${booted.baseUrl}/search`, {
      body: JSON.stringify({ query: 'no-such-token-xyzzy', topK: 3 }),
      headers: { 'content-type': 'application/json' },
      method: 'POST',
    });
    expect(searchResponse.status).toBe(200);

    const json = (await searchResponse.json()) as {
      indexEmpty?: boolean;
      note?: string;
      results: unknown[];
    };
    expect(json.indexEmpty).toBeUndefined();
    expect(json.note).toBeUndefined();
  });

  it('rejects invalid search payloads with VALIDATION_ERROR', async () => {
    booted = await bootApp();

    const response = await fetch(`${booted.baseUrl}/search`, {
      body: JSON.stringify({ query: '   ' }),
      headers: { 'content-type': 'application/json' },
      method: 'POST',
    });

    expect(response.status).toBe(400);

    const json = (await response.json()) as { error: { code: string } };
    expect(json.error.code).toBe('VALIDATION_ERROR');
  });

  it('rejects malformed JSON bodies with INVALID_JSON', async () => {
    booted = await bootApp();

    const response = await fetch(`${booted.baseUrl}/search`, {
      body: '{ "query": "broken',
      headers: { 'content-type': 'application/json' },
      method: 'POST',
    });

    expect(response.status).toBe(400);

    const json = (await response.json()) as { error: { code: string } };
    expect(json.error.code).toBe('INVALID_JSON');
  });

  it('rejects ingest paths that escape the allowed root', async () => {
    booted = await bootApp();

    const response = await fetch(`${booted.baseUrl}/ingest`, {
      body: JSON.stringify({ sourcePath: '../escape.md' }),
      headers: { 'content-type': 'application/json' },
      method: 'POST',
    });

    expect(response.status).toBe(400);

    const json = (await response.json()) as { error: { code: string } };
    expect(json.error.code).toBe('INVALID_DOCUMENT_PATH');
  });

  it('returns 404 for unknown routes', async () => {
    booted = await bootApp();

    const response = await fetch(`${booted.baseUrl}/missing`);

    expect(response.status).toBe(404);
  });
});
