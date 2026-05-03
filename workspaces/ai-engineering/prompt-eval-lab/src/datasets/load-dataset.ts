import { readFile } from 'node:fs/promises';

import { type Dataset, datasetSchema } from './types.js';

export async function loadDataset(filePath: string): Promise<Dataset> {
  const raw = await readFile(filePath, 'utf8');
  let parsed: unknown;

  try {
    parsed = JSON.parse(raw);
  } catch (error) {
    throw new Error(
      `Dataset at ${filePath} is not valid JSON: ${error instanceof Error ? error.message : String(error)}`,
    );
  }

  const result = datasetSchema.safeParse(parsed);

  if (!result.success) {
    const issues = result.error.issues
      .map((issue) => `${issue.path.join('.') || '<root>'}: ${issue.message}`)
      .join('; ');

    throw new Error(`Dataset at ${filePath} failed validation: ${issues}`);
  }

  return result.data;
}
