import { mkdtemp, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { loadDataset } from '../../src/datasets/load-dataset.js';

describe('loadDataset', () => {
  let tempDir: string;

  beforeEach(async () => {
    tempDir = await mkdtemp(path.join(tmpdir(), 'eval-lab-'));
  });

  afterEach(async () => {
    const { rm } = await import('node:fs/promises');
    await rm(tempDir, { force: true, recursive: true });
  });

  it('parses a valid dataset', async () => {
    const file = path.join(tempDir, 'good.json');
    await writeFile(
      file,
      JSON.stringify([
        { format: 'json', solution_criteria: 'Returns valid JSON.', task: 'Generate JSON for X.' },
      ]),
    );

    const dataset = await loadDataset(file);

    expect(dataset).toEqual([
      { format: 'json', solution_criteria: 'Returns valid JSON.', task: 'Generate JSON for X.' },
    ]);
  });

  it('throws a descriptive error for malformed JSON', async () => {
    const file = path.join(tempDir, 'broken.json');
    await writeFile(file, '{not-json');

    await expect(loadDataset(file)).rejects.toThrow(/not valid JSON/);
  });

  it('throws a descriptive error for schema violations', async () => {
    const file = path.join(tempDir, 'wrong-shape.json');
    await writeFile(
      file,
      JSON.stringify([{ format: 'cobol', solution_criteria: '', task: 'Do thing' }]),
    );

    await expect(loadDataset(file)).rejects.toThrow(/failed validation/);
  });
});
