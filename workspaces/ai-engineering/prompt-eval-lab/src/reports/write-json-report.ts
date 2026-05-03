import { mkdir, writeFile } from 'node:fs/promises';
import path from 'node:path';

import type { ReportPayload } from './types.js';

export async function writeJsonReport(filePath: string, payload: ReportPayload): Promise<void> {
  await mkdir(path.dirname(filePath), { recursive: true });
  await writeFile(filePath, `${JSON.stringify(payload, undefined, 2)}\n`, 'utf8');
}
