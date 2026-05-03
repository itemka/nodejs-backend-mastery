import path from 'node:path';

import type { ReportFormat, ReportPayload } from './types.js';
import { writeHtmlReport } from './write-html-report.js';
import { writeJsonReport } from './write-json-report.js';

export type { ReportFormat, ReportPayload, RunMetadata } from './types.js';
export { PASS_SCORE } from './write-html-report.js';

export const DEFAULT_REPORT_FORMAT: ReportFormat = 'html';

export async function writeReport(filePath: string, payload: ReportPayload): Promise<ReportFormat> {
  const format = reportFormatFromPath(filePath);

  if (format === 'html') {
    await writeHtmlReport(filePath, payload);

    return format;
  }

  await writeJsonReport(filePath, payload);

  return format;
}

export function reportFormatFromPath(filePath: string): ReportFormat {
  const extension = path.extname(filePath).toLowerCase();

  if (extension === '.html') {
    return 'html';
  }

  if (extension === '.json') {
    return 'json';
  }

  throw new Error(`Unsupported report extension for ${filePath}. Use .html or .json.`);
}

export function defaultReportPath(
  reportsDir: string,
  now: Date = new Date(),
  format: ReportFormat = DEFAULT_REPORT_FORMAT,
): string {
  const stamp = now.toISOString().replaceAll(':', '-').replaceAll('.', '-');

  return path.join(reportsDir, `${stamp}.${format}`);
}
