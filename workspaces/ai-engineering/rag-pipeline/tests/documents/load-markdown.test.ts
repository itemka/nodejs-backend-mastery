import { mkdtemp, rm, writeFile, mkdir } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';

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

  describe('documentId uniqueness across directories', () => {
    let tempRoot: string | undefined;

    afterEach(async () => {
      if (tempRoot) {
        await rm(tempRoot, { force: true, recursive: true });
        tempRoot = undefined;
      }
    });

    it('encodes the relative path into documentId so duplicate basenames stay distinct', async () => {
      tempRoot = await mkdtemp(path.join(os.tmpdir(), 'rag-load-markdown-'));
      await mkdir(path.join(tempRoot, 'team-a'), { recursive: true });
      await mkdir(path.join(tempRoot, 'team-b'), { recursive: true });
      await writeFile(path.join(tempRoot, 'team-a', 'report.md'), '# Team A\n');
      await writeFile(path.join(tempRoot, 'team-b', 'report.md'), '# Team B\n');

      const teamA = await loadMarkdownDocument({
        allowedRoot: tempRoot,
        relativePath: 'team-a/report.md',
      });
      const teamB = await loadMarkdownDocument({
        allowedRoot: tempRoot,
        relativePath: 'team-b/report.md',
      });

      expect(teamA.documentId).toBe('team-a/report');
      expect(teamB.documentId).toBe('team-b/report');
      expect(teamA.documentId).not.toBe(teamB.documentId);
      expect(teamA.sourceName).toBe('report.md');
      expect(teamB.sourceName).toBe('report.md');
    });
  });
});
