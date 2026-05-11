import { HttpError, NotFoundError } from '@workspaces/packages/errors';
import { readFile } from 'node:fs/promises';
import path from 'node:path';

export interface LoadedDocument {
  readonly content: string;
  readonly documentId: string;
  readonly sourceName: string;
  readonly sourcePath: string;
}

export interface LoadMarkdownOptions {
  readonly allowedRoot: string;
  readonly relativePath?: string;
}

export const DEFAULT_SAMPLE_DOCUMENT_RELATIVE_PATH = 'report.md';

function isInsideRoot(absolute: string, root: string): boolean {
  const relative = path.relative(root, absolute);

  return relative !== '' && !relative.startsWith('..') && !path.isAbsolute(relative);
}

export function resolveDocumentPath(options: LoadMarkdownOptions): string {
  const allowedRoot = path.resolve(options.allowedRoot);
  const relative = options.relativePath ?? DEFAULT_SAMPLE_DOCUMENT_RELATIVE_PATH;

  if (path.isAbsolute(relative)) {
    throw new HttpError({
      code: 'INVALID_DOCUMENT_PATH',
      message: 'sourcePath must be a relative path inside the allowed sample directory.',
      statusCode: 400,
    });
  }

  const resolved = path.resolve(allowedRoot, relative);

  if (!isInsideRoot(resolved, allowedRoot)) {
    throw new HttpError({
      code: 'INVALID_DOCUMENT_PATH',
      message: 'sourcePath escapes the allowed sample directory.',
      statusCode: 400,
    });
  }

  return resolved;
}

export async function loadMarkdownDocument(options: LoadMarkdownOptions): Promise<LoadedDocument> {
  const absolute = resolveDocumentPath(options);

  let content: string;

  try {
    content = await readFile(absolute, 'utf8');
  } catch (error) {
    if (error instanceof Error && 'code' in error && error.code === 'ENOENT') {
      throw new NotFoundError({
        cause: error,
        code: 'DOCUMENT_NOT_FOUND',
        details: { path: path.relative(options.allowedRoot, absolute) },
        message: `Markdown document not found: ${path.relative(options.allowedRoot, absolute)}`,
      });
    }

    throw error;
  }

  const sourceName = path.basename(absolute);
  const documentId = sourceName.replace(/\.[^./\\]+$/, '');

  return {
    content,
    documentId,
    sourceName,
    sourcePath: absolute,
  };
}
