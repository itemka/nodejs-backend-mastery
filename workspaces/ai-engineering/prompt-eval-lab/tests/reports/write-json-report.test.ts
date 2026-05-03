import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { writeJsonReport } from '../../src/reports/write-json-report.js';
import { buildPayload } from './report-fixtures.js';

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
