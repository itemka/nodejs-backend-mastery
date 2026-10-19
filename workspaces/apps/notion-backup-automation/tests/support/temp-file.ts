import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { onTestFinished } from 'vitest';

/** Writes `content` to a file in a new temp directory, removed when the test finishes. */
export async function tempFile(content: Uint8Array, name = 'backup.zip'): Promise<string> {
  const directory = await mkdtemp(path.join(tmpdir(), 'nba-file-'));

  onTestFinished(() => rm(directory, { force: true, recursive: true }));

  const file = path.join(directory, name);

  await writeFile(file, content);

  return file;
}
