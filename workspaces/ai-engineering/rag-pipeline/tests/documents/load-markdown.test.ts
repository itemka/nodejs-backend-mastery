import path from 'node:path';
import { describe, expect, it } from 'vitest';

import { loadMarkdownDocument, resolveDocumentPath } from '../../src/documents/load-markdown.js';

const fixturesRoot = path.resolve(import.meta.dirname, '..', 'fixtures');

describe('resolveDocumentPath', () => {
  it('resolves a relative path inside the allowed root', () => {
    const resolved = resolveDocumentPath({
      allowedRoot: fixturesRoot,
      relativePath: 'sample-report.md',
    });

    expect(resolved).toBe(path.resolve(fixturesRoot, 'sample-report.md'));
  });

  it('rejects absolute paths', () => {
    expect(() =>
      resolveDocumentPath({ allowedRoot: fixturesRoot, relativePath: '/etc/passwd' }),
    ).toThrow(/relative path/);
  });

  it('rejects paths that escape the allowed root', () => {
    expect(() =>
      resolveDocumentPath({ allowedRoot: fixturesRoot, relativePath: '../../etc/passwd' }),
    ).toThrow(/escapes the allowed/);
  });
});

describe('loadMarkdownDocument', () => {
  it('loads markdown content and metadata', async () => {
    const document = await loadMarkdownDocument({
      allowedRoot: fixturesRoot,
      relativePath: 'sample-report.md',
    });

    expect(document.documentId).toBe('sample-report');
    expect(document.sourceName).toBe('sample-report.md');
    expect(document.content).toContain('INC-2023-Q4-011');
  });

  it('throws DOCUMENT_NOT_FOUND for missing files', async () => {
    await expect(
      loadMarkdownDocument({ allowedRoot: fixturesRoot, relativePath: 'missing.md' }),
    ).rejects.toThrowError(/not found/);
  });
});
