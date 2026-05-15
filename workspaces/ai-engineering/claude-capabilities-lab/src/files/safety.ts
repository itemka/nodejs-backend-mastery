import fs from 'node:fs/promises';
import path from 'node:path';

import { getLabRoot } from '../config/env.js';
import {
  CODE_EXEC_UPLOAD_EXTENSIONS,
  detectCodeExecUploadMime,
  detectImageMimeFromExtension,
  detectImageMimeFromHeader,
  looksLikePdf,
  type SupportedImageMimeType,
} from './mime.js';

export const MAX_MESSAGES_REQUEST_BYTES = 32 * 1024 * 1024;
export const MAX_FILES_API_UPLOAD_BYTES = 500 * 1024 * 1024;
export const MAX_PDF_PAGES_LARGE_CONTEXT = 600;
export const MAX_PDF_PAGES_DEFAULT = 100;
const MAX_HEADER_READ_BYTES = 32;

export interface ValidatedFile {
  readonly absolutePath: string;
  readonly buffer: Buffer;
  readonly sizeBytes: number;
}

export interface ValidatedUploadFile {
  readonly absolutePath: string;
  readonly mimeType: string;
  readonly sizeBytes: number;
}

async function statExistingFile(
  filePath: string,
  options: { readonly maxBytes?: number } = {},
): Promise<{ readonly absolutePath: string; readonly sizeBytes: number }> {
  const resolved = path.resolve(filePath);
  const stat = await fs.stat(resolved).catch((error: unknown) => {
    if (error instanceof Error && 'code' in error && error.code === 'ENOENT') {
      throw new Error(`File not found: ${resolved}`);
    }

    throw error;
  });

  if (!stat.isFile()) {
    throw new Error(`Path is not a file: ${resolved}`);
  }

  if (options.maxBytes !== undefined && stat.size > options.maxBytes) {
    throw new Error(
      `File ${resolved} is ${stat.size} bytes, exceeds limit of ${options.maxBytes} bytes.`,
    );
  }

  return { absolutePath: resolved, sizeBytes: stat.size };
}

async function readExistingFile(
  filePath: string,
  options: { readonly maxBytes?: number } = {},
): Promise<ValidatedFile> {
  const file = await statExistingFile(filePath, options);
  const buffer = await fs.readFile(file.absolutePath);

  return { ...file, buffer };
}

export async function loadImageFile(filePath: string): Promise<{
  readonly base64: string;
  readonly file: ValidatedFile;
  readonly mediaType: SupportedImageMimeType;
}> {
  const file = await readExistingFile(filePath, { maxBytes: MAX_MESSAGES_REQUEST_BYTES });
  const extMime = detectImageMimeFromExtension(file.absolutePath);

  if (extMime === undefined) {
    throw new Error(
      `Unsupported image extension for ${file.absolutePath}. Supported: .jpg, .jpeg, .png, .gif, .webp.`,
    );
  }

  const header = file.buffer.subarray(0, Math.min(file.sizeBytes, MAX_HEADER_READ_BYTES));
  const headerMime = detectImageMimeFromHeader(header);

  if (headerMime === undefined) {
    throw new Error(`File ${file.absolutePath} does not look like a supported image.`);
  }

  if (headerMime !== extMime) {
    throw new Error(
      `Image MIME mismatch for ${file.absolutePath}: extension says ${extMime}, header says ${headerMime}.`,
    );
  }

  return { base64: file.buffer.toString('base64'), file, mediaType: headerMime };
}

export async function loadPdfFile(filePath: string): Promise<{
  readonly base64: string;
  readonly file: ValidatedFile;
}> {
  const file = await readExistingFile(filePath, { maxBytes: MAX_MESSAGES_REQUEST_BYTES });

  if (path.extname(file.absolutePath).toLowerCase() !== '.pdf') {
    throw new Error(`Expected a .pdf file, received ${file.absolutePath}.`);
  }

  if (!looksLikePdf(file.buffer)) {
    throw new Error(`File ${file.absolutePath} does not have a %PDF- header.`);
  }

  return { base64: file.buffer.toString('base64'), file };
}

export async function loadTextFile(filePath: string): Promise<{
  readonly content: string;
  readonly file: ValidatedFile;
}> {
  const file = await readExistingFile(filePath, { maxBytes: MAX_MESSAGES_REQUEST_BYTES });

  return { content: file.buffer.toString('utf8'), file };
}

export async function loadCodeExecUpload(filePath: string): Promise<ValidatedUploadFile> {
  const file = await statExistingFile(filePath, { maxBytes: MAX_FILES_API_UPLOAD_BYTES });
  const mimeType = detectCodeExecUploadMime(file.absolutePath);

  if (mimeType === undefined) {
    throw new Error(
      `Unsupported file extension for code execution upload: ${file.absolutePath}. Supported: ${CODE_EXEC_UPLOAD_EXTENSIONS.join(', ')}.`,
    );
  }

  return { ...file, mimeType };
}

export async function loadFilesApiUpload(filePath: string): Promise<ValidatedUploadFile> {
  const file = await statExistingFile(filePath, { maxBytes: MAX_FILES_API_UPLOAD_BYTES });
  const mimeType = detectCodeExecUploadMime(file.absolutePath);

  if (mimeType === undefined) {
    throw new Error(
      `Unsupported file extension for Files API upload: ${file.absolutePath}. Supported: ${CODE_EXEC_UPLOAD_EXTENSIONS.join(', ')}.`,
    );
  }

  return { ...file, mimeType };
}

export function resolveOutputDir(outDir: string): { readonly absolutePath: string } {
  const labRoot = getLabRoot();
  const resolvedOutDir = path.resolve(labRoot, outDir);
  const allowedOutRoot = path.resolve(labRoot, 'outputs');

  if (!resolvedOutDir.startsWith(allowedOutRoot + path.sep) && resolvedOutDir !== allowedOutRoot) {
    throw new Error(
      `Output directory must live under ${allowedOutRoot}, received ${resolvedOutDir}.`,
    );
  }

  return { absolutePath: resolvedOutDir };
}

export function resolveOutputPath(
  outDir: string,
  filename: string,
): { readonly absolutePath: string; readonly outDirPath: string } {
  const { absolutePath: outDirPath } = resolveOutputDir(outDir);
  const safeFilename = sanitizeRemoteFilename(filename);
  const candidate = path.resolve(outDirPath, safeFilename);

  if (candidate !== outDirPath && !candidate.startsWith(outDirPath + path.sep)) {
    throw new Error(`Resolved output path escapes ${outDirPath}: ${candidate}.`);
  }

  return { absolutePath: candidate, outDirPath };
}

export function sanitizeRemoteFilename(filename: string): string {
  if (filename === '' || filename === '.' || filename === '..') {
    throw new Error(`Refusing to write file with name "${filename}".`);
  }

  const base = path.basename(filename);

  if (base.startsWith('.')) {
    throw new Error(`Refusing to write hidden filename "${base}".`);
  }

  if (base !== filename) {
    throw new Error(`Filename "${filename}" contains path separators; expected a plain filename.`);
  }

  return base.replaceAll(/[^a-zA-Z0-9._-]/g, '_');
}

export async function ensureDirectory(dirPath: string): Promise<void> {
  await fs.mkdir(dirPath, { recursive: true });
}
