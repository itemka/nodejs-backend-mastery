import { mkdir, writeFile } from 'node:fs/promises';
import path from 'node:path';

import type { EvalResult, EvalSummary } from '../eval/types.js';

export interface RunMetadata {
  readonly concurrency: number;
  readonly datasetPath: string;
  readonly finishedAt: string;
  readonly model: string;
  readonly startedAt: string;
  readonly templateName: string;
}

export interface ReportPayload {
  readonly metadata: RunMetadata;
  readonly results: readonly EvalResult[];
  readonly summary: EvalSummary;
}

export async function writeJsonReport(filePath: string, payload: ReportPayload): Promise<void> {
  await mkdir(path.dirname(filePath), { recursive: true });
  await writeFile(filePath, `${JSON.stringify(payload, undefined, 2)}\n`, 'utf8');
}

export function defaultReportPath(reportsDir: string, now: Date = new Date()): string {
  const stamp = now.toISOString().replaceAll(':', '-').replaceAll('.', '-');

  return path.join(reportsDir, `${stamp}.json`);
}
