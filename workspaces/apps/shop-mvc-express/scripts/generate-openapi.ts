import { mkdir, readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { format } from 'prettier';

import { openApiDocument } from '../src/openapi/document';

const REGENERATE_HINT =
  "Run 'pnpm --filter shop-mvc-express openapi:generate' and commit the result.";

const outputPath = fileURLToPath(new URL('../docs/openapi.json', import.meta.url));
const serializedDocument = await format(JSON.stringify(openApiDocument, undefined, 2), {
  endOfLine: 'lf',
  parser: 'json',
  printWidth: 100,
  tabWidth: 2,
});

async function checkGeneratedDocument(): Promise<void> {
  let committedDocument: string;

  try {
    committedDocument = await readFile(outputPath, 'utf8');
  } catch {
    throw new Error(`The generated OpenAPI artifact is missing. ${REGENERATE_HINT}`);
  }

  if (committedDocument !== serializedDocument) {
    throw new Error(`The generated OpenAPI artifact is stale. ${REGENERATE_HINT}`);
  }

  console.log('Generated OpenAPI artifact is current.');
}

async function generateDocument(): Promise<void> {
  await mkdir(path.dirname(outputPath), { recursive: true });
  await writeFile(outputPath, serializedDocument, 'utf8');
  console.log(`Generated ${outputPath}`);
}

const operation = process.argv.includes('--check') ? checkGeneratedDocument : generateDocument;

await operation();
