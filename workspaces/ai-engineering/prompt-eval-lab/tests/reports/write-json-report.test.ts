import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import type { EvalResult } from '../../src/eval/types.js';
import {
  defaultReportPath,
  type ReportPayload,
  writeJsonReport,
} from '../../src/reports/write-json-report.js';

function buildPayload(results: EvalResult[] = []): ReportPayload {
  return {
    metadata: {
      concurrency: 3,
      datasetPath: '/tmp/dataset.json',
      finishedAt: '2026-05-01T00:00:01Z',
      model: 'claude-sonnet-4-6',
      startedAt: '2026-05-01T00:00:00Z',
      templateName: 'code-assistant.v1',
    },
    results,
    summary: {
      averageScore: 0,
      byFormat: {
        json: { average: 0, count: 0 },
        regex: { average: 0, count: 0 },
        typescript: { average: 0, count: 0 },
      },
      total: 0,
    },
  };
}

describe('writeJsonReport', () => {
  let tempDir: string;

  beforeEach(async () => {
    tempDir = await mkdtemp(path.join(tmpdir(), 'eval-report-'));
  });

  afterEach(async () => {
    await rm(tempDir, { force: true, recursive: true });
  });

  it('writes the payload as pretty-printed JSON', async () => {
    const file = path.join(tempDir, 'out.json');
    await writeJsonReport(file, buildPayload());

    const written = JSON.parse(await readFile(file, 'utf8'));

    expect(written.metadata.model).toBe('claude-sonnet-4-6');
    expect(written.summary.total).toBe(0);
  });

  it('creates intermediate directories', async () => {
    const file = path.join(tempDir, 'nested', 'inner', 'out.json');
    await writeJsonReport(file, buildPayload());

    const written = JSON.parse(await readFile(file, 'utf8'));

    expect(written).toBeDefined();
  });
});

describe('defaultReportPath', () => {
  it('builds an ISO-stamped path under the reports directory', () => {
    const filePath = defaultReportPath('/tmp/reports', new Date('2026-05-01T12:34:56.000Z'));

    expect(filePath.startsWith('/tmp/reports/')).toBe(true);
    expect(filePath.endsWith('.json')).toBe(true);
    expect(filePath).not.toContain(':');
  });
});
