import { copyFile, mkdir, readdir, readFile, stat, writeFile } from 'node:fs/promises';
import path from 'node:path';

import type { ResolvedPath } from './path-safety.js';

export class TextEditorOperationError extends Error {
  readonly code: string;

  constructor(code: string, message: string) {
    super(message);
    this.code = code;
    this.name = 'TextEditorOperationError';
  }
}

const DEFAULT_MAX_VIEW_BYTES = 256 * 1024;
const DEFAULT_MAX_EDITABLE_BYTES = 1024 * 1024;
const BINARY_SCAN_BYTE_LIMIT = 8 * 1024;

export interface OperationLimits {
  readonly maxEditableBytes: number;
  readonly maxViewBytes: number;
  readonly maxViewCharacters?: number;
}

export function resolveLimits(config: Partial<OperationLimits> | undefined): OperationLimits {
  return {
    maxEditableBytes: config?.maxEditableBytes ?? DEFAULT_MAX_EDITABLE_BYTES,
    maxViewBytes: config?.maxViewBytes ?? DEFAULT_MAX_VIEW_BYTES,
    ...(config?.maxViewCharacters === undefined
      ? {}
      : { maxViewCharacters: config.maxViewCharacters }),
  };
}

function looksBinary(buffer: Buffer): boolean {
  const length = Math.min(buffer.length, BINARY_SCAN_BYTE_LIMIT);

  for (let i = 0; i < length; i += 1) {
    const byte = buffer[i];

    if (byte === 0) {
      return true;
    }
  }

  return false;
}

function isUtf8(buffer: Buffer): boolean {
  try {
    const decoder = new TextDecoder('utf-8', { fatal: true });
    decoder.decode(buffer);

    return true;
  } catch {
    return false;
  }
}

function detectLineEnding(text: string): '\r\n' | '\n' {
  return text.includes('\r\n') ? '\r\n' : '\n';
}

function splitLinesPreserveEmptyTrailing(text: string): string[] {
  if (text === '') {
    return [];
  }

  return text.split(/\r\n|\n/);
}

function joinLines(lines: readonly string[], lineEnding: string): string {
  return lines.join(lineEnding);
}

function formatLineNumberedView(text: string, startLine: number): string {
  const lines = splitLinesPreserveEmptyTrailing(text);
  const lastLine = startLine + lines.length - 1;
  const width = String(Math.max(lastLine, startLine)).length;

  return lines
    .map((line, index) => {
      const number = String(startLine + index).padStart(width, ' ');

      return `${number}\t${line}`;
    })
    .join('\n');
}

export interface ViewOptions {
  readonly limits: OperationLimits;
  readonly resolved: ResolvedPath;
  readonly viewRange?: readonly [number, number];
}

export interface ViewResult {
  readonly content: string;
  readonly truncated: boolean;
}

async function viewDirectory(absolutePath: string): Promise<ViewResult> {
  const entries = await readdir(absolutePath, { withFileTypes: true });
  const lines = entries
    .filter((entry) => !entry.name.startsWith('.'))
    .toSorted((a, b) => a.name.localeCompare(b.name))
    .map((entry) => `${entry.isDirectory() ? 'd' : '-'} ${entry.name}`);

  return { content: lines.join('\n'), truncated: false };
}

async function viewFile(options: ViewOptions): Promise<ViewResult> {
  const { absolutePath } = options.resolved;
  const limits = options.limits;
  const stats = await stat(absolutePath);

  if (stats.size > limits.maxViewBytes) {
    throw new TextEditorOperationError(
      'file_too_large',
      `File is too large to view (size ${stats.size} bytes, limit ${limits.maxViewBytes}).`,
    );
  }

  const buffer = await readFile(absolutePath);

  if (looksBinary(buffer) || !isUtf8(buffer)) {
    throw new TextEditorOperationError(
      'binary_file',
      'Binary or non-UTF-8 files are not supported.',
    );
  }

  const text = buffer.toString('utf8');
  const lines = splitLinesPreserveEmptyTrailing(text);
  let startIndex = 0;
  let endIndex = lines.length;

  if (options.viewRange !== undefined) {
    const [rangeStart, rangeEnd] = options.viewRange;

    if (rangeStart > lines.length) {
      throw new TextEditorOperationError(
        'view_range_out_of_bounds',
        `view_range[0]=${rangeStart} is beyond file length ${lines.length}.`,
      );
    }

    startIndex = rangeStart - 1;
    endIndex = rangeEnd === -1 ? lines.length : Math.min(rangeEnd, lines.length);
  }

  const slice = lines.slice(startIndex, endIndex);
  const sliceText = slice.join('\n');
  let truncated = false;
  let displayText = sliceText;

  if (limits.maxViewCharacters !== undefined && displayText.length > limits.maxViewCharacters) {
    displayText = displayText.slice(0, limits.maxViewCharacters);
    truncated = true;
  }

  const numbered = formatLineNumberedView(displayText, startIndex + 1);
  const suffix = truncated ? '\n[truncated]' : '';

  return { content: `${numbered}${suffix}`, truncated };
}

export async function viewPath(options: ViewOptions): Promise<ViewResult> {
  const stats = await stat(options.resolved.absolutePath).catch((error: unknown) => {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') {
      throw new TextEditorOperationError('not_found', 'Path does not exist.');
    }

    throw error;
  });

  if (stats.isDirectory()) {
    return viewDirectory(options.resolved.absolutePath);
  }

  if (!stats.isFile()) {
    throw new TextEditorOperationError(
      'unsupported_target',
      'Only regular files and directories are supported.',
    );
  }

  return viewFile(options);
}

export async function createFile(
  resolved: ResolvedPath,
  fileText: string,
  limits: OperationLimits,
): Promise<void> {
  if (Buffer.byteLength(fileText, 'utf8') > limits.maxEditableBytes) {
    throw new TextEditorOperationError(
      'file_too_large',
      `New file content exceeds the editable byte limit of ${limits.maxEditableBytes}.`,
    );
  }

  await mkdir(path.dirname(resolved.absolutePath), { recursive: true });

  try {
    await writeFile(resolved.absolutePath, fileText, { encoding: 'utf8', flag: 'wx' });
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'EEXIST') {
      throw new TextEditorOperationError(
        'file_exists',
        'create cannot overwrite an existing file.',
      );
    }

    throw error;
  }
}

export interface BackupContext {
  readonly backupRoot: string;
  readonly relativeFromRoot: string;
}

async function snapshotFile(resolved: ResolvedPath, context: BackupContext): Promise<string> {
  const target = path.resolve(context.backupRoot, context.relativeFromRoot);
  await mkdir(path.dirname(target), { recursive: true });
  await copyFile(resolved.absolutePath, target);

  return target;
}

async function readUtf8File(resolved: ResolvedPath, limits: OperationLimits): Promise<string> {
  const stats = await stat(resolved.absolutePath).catch((error: unknown) => {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') {
      throw new TextEditorOperationError('not_found', 'Path does not exist.');
    }

    throw error;
  });

  if (!stats.isFile()) {
    throw new TextEditorOperationError('unsupported_target', 'Only regular files can be edited.');
  }

  if (stats.size > limits.maxEditableBytes) {
    throw new TextEditorOperationError(
      'file_too_large',
      `File is too large to edit (size ${stats.size} bytes, limit ${limits.maxEditableBytes}).`,
    );
  }

  const buffer = await readFile(resolved.absolutePath);

  if (looksBinary(buffer) || !isUtf8(buffer)) {
    throw new TextEditorOperationError(
      'binary_file',
      'Binary or non-UTF-8 files are not supported for editing.',
    );
  }

  return buffer.toString('utf8');
}

export interface StrReplaceArgs {
  readonly backup: BackupContext;
  readonly limits: OperationLimits;
  readonly newStr: string;
  readonly oldStr: string;
  readonly resolved: ResolvedPath;
}

export interface StrReplaceResult {
  readonly backupPath: string;
}

function countOccurrences(text: string, search: string): number {
  if (search === '') {
    throw new TextEditorOperationError('invalid_input', 'old_str must not be empty.');
  }

  let count = 0;
  let cursor = 0;

  while (true) {
    const next = text.indexOf(search, cursor);

    if (next === -1) {
      return count;
    }

    count += 1;
    cursor = next + search.length;
  }
}

export async function strReplace(args: StrReplaceArgs): Promise<StrReplaceResult> {
  const original = await readUtf8File(args.resolved, args.limits);
  const matches = countOccurrences(original, args.oldStr);

  if (matches === 0) {
    throw new TextEditorOperationError('no_match', 'old_str was not found in the file.');
  }

  if (matches > 1) {
    throw new TextEditorOperationError(
      'multiple_matches',
      `old_str matched ${matches} times; expected exactly one match.`,
    );
  }

  const backupPath = await snapshotFile(args.resolved, args.backup);
  const updated = original.replace(args.oldStr, args.newStr);

  if (Buffer.byteLength(updated, 'utf8') > args.limits.maxEditableBytes) {
    throw new TextEditorOperationError(
      'file_too_large',
      `Edited content exceeds the editable byte limit of ${args.limits.maxEditableBytes}.`,
    );
  }

  await writeFile(args.resolved.absolutePath, updated, 'utf8');

  return { backupPath };
}

export interface InsertArgs {
  readonly backup: BackupContext;
  readonly insertLine: number;
  readonly insertText: string;
  readonly limits: OperationLimits;
  readonly resolved: ResolvedPath;
}

export interface InsertResult {
  readonly backupPath: string;
}

export async function insertAtLine(args: InsertArgs): Promise<InsertResult> {
  const original = await readUtf8File(args.resolved, args.limits);
  const lineEnding = detectLineEnding(original);
  const lines = splitLinesPreserveEmptyTrailing(original);

  if (args.insertLine > lines.length) {
    throw new TextEditorOperationError(
      'insert_line_out_of_bounds',
      `insert_line=${args.insertLine} is beyond file length ${lines.length}.`,
    );
  }

  const insertChunkLines = splitLinesPreserveEmptyTrailing(args.insertText);
  const before = lines.slice(0, args.insertLine);
  const after = lines.slice(args.insertLine);
  const merged = [...before, ...insertChunkLines, ...after];
  const updated = joinLines(merged, lineEnding);

  if (Buffer.byteLength(updated, 'utf8') > args.limits.maxEditableBytes) {
    throw new TextEditorOperationError(
      'file_too_large',
      `Edited content exceeds the editable byte limit of ${args.limits.maxEditableBytes}.`,
    );
  }

  const backupPath = await snapshotFile(args.resolved, args.backup);
  await writeFile(args.resolved.absolutePath, updated, 'utf8');

  return { backupPath };
}
