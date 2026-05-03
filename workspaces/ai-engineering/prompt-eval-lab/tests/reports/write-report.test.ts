import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import {
  defaultReportPath,
  reportFormatFromPath,
  writeReport,
} from '../../src/reports/write-report.js';
import { buildPayload, makeResult } from './report-fixtures.js';

describe('writeReport', () => {
  let tempDir: string;

  beforeEach(async () => {
    tempDir = await mkdtemp(path.join(tmpdir(), 'eval-report-'));
  });

  afterEach(async () => {
    await rm(tempDir, { force: true, recursive: true });
  });

  it('writes an HTML report for .html paths', async () => {
    const file = path.join(tempDir, 'out.html');
    const format = await writeReport(file, buildPayload([makeResult()]));

    const written = await readFile(file, 'utf8');

    expect(format).toBe('html');
    expect(written).toContain('<title>Prompt Evaluation Report</title>');
  });

  it('writes a JSON report for .json paths', async () => {
    const file = path.join(tempDir, 'out.json');
    const format = await writeReport(file, buildPayload());

    const written = JSON.parse(await readFile(file, 'utf8'));

    expect(format).toBe('json');
    expect(written.metadata.model).toBe('claude-sonnet-4-6');
  });

  it('rejects unsupported report extensions', async () => {
    await expect(writeReport(path.join(tempDir, 'out.htm'), buildPayload())).rejects.toThrow(
      /\.html or \.json/,
    );
  });
});

describe('defaultReportPath', () => {
  it('builds an ISO-stamped HTML path under the reports directory by default', () => {
    const filePath = defaultReportPath('/tmp/reports', new Date('2026-05-01T12:34:56.000Z'));

    expect(filePath.startsWith('/tmp/reports/')).toBe(true);
    expect(filePath.endsWith('.html')).toBe(true);
    expect(filePath).not.toContain(':');
  });

  it('can build a JSON report path', () => {
    const filePath = defaultReportPath(
      '/tmp/reports',
      new Date('2026-05-01T12:34:56.000Z'),
      'json',
    );

    expect(filePath.endsWith('.json')).toBe(true);
  });
});

describe('reportFormatFromPath', () => {
  it('supports only .html and .json paths', () => {
    expect(reportFormatFromPath('reports/run.html')).toBe('html');
    expect(reportFormatFromPath('reports/run.json')).toBe('json');
  });

  it('rejects .htm and extensionless paths', () => {
    expect(() => reportFormatFromPath('reports/run.htm')).toThrow(/\.html or \.json/);
    expect(() => reportFormatFromPath('reports/run')).toThrow(/\.html or \.json/);
  });
});
