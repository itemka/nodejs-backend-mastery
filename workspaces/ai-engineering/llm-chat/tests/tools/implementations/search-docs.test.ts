import { describe, expect, it, vi } from 'vitest';

import { searchDocsTool } from '../../../src/tools/implementations/search-docs.js';
import type {
  SearchDocsClient,
  SearchDocsResultChunk,
} from '../../../src/tools/search-docs-client.js';
import { createReminderStore } from '../../../src/tools/types.js';
import type { AppToolExecutionContext } from '../../../src/tools/types.js';

function makeChunk(
  overrides: {
    -readonly [K in keyof SearchDocsResultChunk]?: SearchDocsResultChunk[K] | undefined;
  } = {},
): SearchDocsResultChunk {
  const base: SearchDocsResultChunk = {
    chunkId: 'sample-report#sec0',
    chunkIndex: 0,
    content: 'Incident INC-2023-Q4-011 hit the payment gateway after a deploy.',
    documentId: 'sample-report',
    fusedScore: 0.42,
    sectionTitle: 'Incident INC-2023-Q4-011',
    sourceName: 'sample-report.md',
    sourcePath: '/repo/sample-documents/sample-report.md',
  };
  const merged: { -readonly [K in keyof SearchDocsResultChunk]?: SearchDocsResultChunk[K] } = {
    ...base,
  };

  for (const key of Object.keys(overrides) as (keyof SearchDocsResultChunk)[]) {
    const value = overrides[key];

    if (value === undefined) {
      delete merged[key];
    } else {
      merged[key] = value as never;
    }
  }

  return merged as SearchDocsResultChunk;
}

function createContext(client?: SearchDocsClient): AppToolExecutionContext {
  return {
    now: () => new Date('2026-05-09T00:00:00.000Z'),
    reminderStore: createReminderStore(),
    ...(client === undefined ? {} : { searchDocsClient: client }),
  };
}

describe('search_docs tool', () => {
  it('rejects invalid input', async () => {
    const context = createContext({ search: vi.fn() });

    await expect(searchDocsTool.execute({ query: '   ' }, context)).rejects.toThrow(/query/);
    await expect(searchDocsTool.execute({ query: 'ok', topK: 0 }, context)).rejects.toThrow(/topK/);
    await expect(searchDocsTool.execute('not-an-object', context)).rejects.toThrow(/object/);
  });

  it('throws when no RAG client is configured', async () => {
    const context = createContext();

    await expect(searchDocsTool.execute({ query: 'hi' }, context)).rejects.toThrow(
      /not configured/,
    );
  });

  it('calls the configured client and returns compact chunks', async () => {
    const client: SearchDocsClient = {
      search: vi.fn().mockResolvedValue({
        query: 'INC-2023-Q4-011',
        results: [
          makeChunk(),
          makeChunk({ chunkId: 'sample-report#sec1', sectionTitle: undefined }),
        ],
        topK: 5,
      }),
    };
    const context = createContext(client);

    const result = (await searchDocsTool.execute(
      { query: 'INC-2023-Q4-011', topK: 5 },
      context,
    )) as { query: string; results: { chunkId: string; score: number }[]; topK: number };

    expect(vi.mocked(client.search)).toHaveBeenCalledWith({ query: 'INC-2023-Q4-011', topK: 5 });
    expect(result.query).toBe('INC-2023-Q4-011');
    expect(result.topK).toBe(5);
    expect(result.results).toHaveLength(2);
    expect(result.results[0]).toMatchObject({
      chunkId: 'sample-report#sec0',
      score: 0.42,
      sectionTitle: 'Incident INC-2023-Q4-011',
    });
  });

  it('caps topK at the configured maximum', async () => {
    const client: SearchDocsClient = {
      search: vi.fn().mockResolvedValue({ query: 'q', results: [], topK: 10 }),
    };
    const context = createContext(client);

    await searchDocsTool.execute({ query: 'q', topK: 999 }, context);

    expect(vi.mocked(client.search)).toHaveBeenCalledWith({ query: 'q', topK: 10 });
  });

  it('passes indexEmpty and note through to the tool result', async () => {
    const client: SearchDocsClient = {
      search: vi.fn().mockResolvedValue({
        indexEmpty: true,
        note: 'The document index is empty — no documents have been ingested yet.',
        query: 'INC-2023-Q4-011',
        results: [],
        topK: 5,
      }),
    };
    const context = createContext(client);

    const result = (await searchDocsTool.execute({ query: 'INC-2023-Q4-011' }, context)) as {
      indexEmpty?: boolean;
      note?: string;
      results: unknown[];
    };

    expect(result.indexEmpty).toBe(true);
    expect(result.note).toMatch(/empty/i);
    expect(result.results).toEqual([]);
  });

  it('omits indexEmpty and note when not flagged by the service', async () => {
    const client: SearchDocsClient = {
      search: vi.fn().mockResolvedValue({
        query: 'q',
        results: [makeChunk()],
        topK: 5,
      }),
    };
    const context = createContext(client);

    const result = (await searchDocsTool.execute({ query: 'q' }, context)) as Record<
      string,
      unknown
    >;

    expect('indexEmpty' in result).toBe(false);
    expect('note' in result).toBe(false);
  });

  it('truncates long content', async () => {
    const longContent = 'x'.repeat(5000);
    const client: SearchDocsClient = {
      search: vi.fn().mockResolvedValue({
        query: 'q',
        results: [makeChunk({ content: longContent, sectionTitle: undefined })],
        topK: 1,
      }),
    };
    const context = createContext(client);

    const result = (await searchDocsTool.execute({ query: 'q', topK: 1 }, context)) as {
      results: { content: string }[];
    };

    expect(result.results[0]?.content.endsWith('...')).toBe(true);
    expect(result.results[0]?.content.length).toBeLessThan(longContent.length);
  });
});
