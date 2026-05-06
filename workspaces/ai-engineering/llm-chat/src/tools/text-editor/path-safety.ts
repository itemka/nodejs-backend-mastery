import { realpath } from 'node:fs/promises';
import path from 'node:path';

const BLOCKED_PATH_SEGMENTS = new Set(['.git', 'node_modules']);
const BLOCKED_FILE_PATTERNS = [/^\.env$/, /^\.env\..+$/];

export const DEFAULT_BACKUP_DIRNAME = '.llm-chat-edit-backups';

export class TextEditorPathError extends Error {
  readonly code: string;

  constructor(code: string, message: string) {
    super(message);
    this.code = code;
    this.name = 'TextEditorPathError';
  }
}

export interface ResolvePathOptions {
  readonly allowHiddenPaths?: boolean;
  readonly backupRoot: string;
  readonly mustExist?: boolean;
  readonly requestedPath: string;
  readonly validateExistingParent?: boolean;
  readonly workspaceRoot: string;
}

export interface ResolvedPath {
  readonly absolutePath: string;
  readonly relativeFromRoot: string;
}

function ensureAbsolute(value: string): string {
  return path.isAbsolute(value) ? value : path.resolve(value);
}

function isInsideRoot(absolutePath: string, root: string): boolean {
  const relative = path.relative(root, absolutePath);

  return relative === '' || (!relative.startsWith('..') && !path.isAbsolute(relative));
}

function startsWithDot(name: string): boolean {
  return name !== '' && name !== '.' && name !== '..' && name.startsWith('.');
}

function checkBlockedSegments(relative: string, allowHiddenPaths: boolean): void {
  if (relative === '') {
    return;
  }

  const segments = relative.split(path.sep);

  for (const segment of segments) {
    if (segment === '') {
      continue;
    }

    if (BLOCKED_PATH_SEGMENTS.has(segment)) {
      throw new TextEditorPathError('blocked_path', `Path is blocked: ${segment} is not allowed.`);
    }

    if (!allowHiddenPaths && startsWithDot(segment)) {
      throw new TextEditorPathError(
        'blocked_hidden_path',
        'Hidden paths are not allowed without --allow-hidden-files.',
      );
    }

    for (const pattern of BLOCKED_FILE_PATTERNS) {
      if (pattern.test(segment)) {
        throw new TextEditorPathError(
          'blocked_secret_path',
          'Secret env paths are blocked by default.',
        );
      }
    }
  }
}

function checkBackupRoot(absolutePath: string, backupRoot: string): void {
  const absoluteBackupRoot = ensureAbsolute(backupRoot);

  if (isInsideRoot(absolutePath, absoluteBackupRoot)) {
    throw new TextEditorPathError(
      'blocked_backup_path',
      'Backup directory is not exposed to the model.',
    );
  }
}

async function resolveSymlinkSafe(absolutePath: string): Promise<string | undefined> {
  try {
    return await realpath(absolutePath);
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') {
      return undefined;
    }

    throw error;
  }
}

async function resolveWorkspaceRoot(workspaceRoot: string): Promise<string> {
  return (await resolveSymlinkSafe(workspaceRoot)) ?? workspaceRoot;
}

function checkRealPath(
  realPath: string,
  workspaceRoot: string,
  realWorkspaceRoot: string,
  backupRoot: string,
  allowHiddenPaths: boolean,
): void {
  if (!isInsideRoot(realPath, workspaceRoot) && !isInsideRoot(realPath, realWorkspaceRoot)) {
    throw new TextEditorPathError(
      'symlink_escape',
      'Path resolves outside the allowed workspace root via a symbolic link.',
    );
  }

  checkBlockedSegments(path.relative(realWorkspaceRoot, realPath), allowHiddenPaths);
  checkBackupRoot(realPath, backupRoot);
}

async function resolveNearestExistingParent(
  absolutePath: string,
  workspaceRoot: string,
): Promise<string | undefined> {
  let current = path.dirname(absolutePath);

  while (isInsideRoot(current, workspaceRoot)) {
    const realCurrent = await resolveSymlinkSafe(current);

    if (realCurrent !== undefined) {
      return realCurrent;
    }

    if (current === workspaceRoot) {
      break;
    }

    current = path.dirname(current);
  }

  return undefined;
}

export async function resolveSafePath(options: ResolvePathOptions): Promise<ResolvedPath> {
  const workspaceRoot = ensureAbsolute(options.workspaceRoot);
  const requested = options.requestedPath;
  const allowHiddenPaths = options.allowHiddenPaths === true;

  if (typeof requested !== 'string' || requested === '') {
    throw new TextEditorPathError('invalid_path', 'Path must be a non-empty string.');
  }

  const absolutePath = path.isAbsolute(requested)
    ? path.normalize(requested)
    : path.resolve(workspaceRoot, requested);

  if (!isInsideRoot(absolutePath, workspaceRoot)) {
    throw new TextEditorPathError(
      'outside_workspace',
      'Path is outside the allowed workspace root.',
    );
  }

  const relativeFromRoot = path.relative(workspaceRoot, absolutePath);

  checkBlockedSegments(relativeFromRoot, allowHiddenPaths);
  checkBackupRoot(absolutePath, options.backupRoot);

  const realResolved = await resolveSymlinkSafe(absolutePath);
  const realWorkspaceRoot = await resolveWorkspaceRoot(workspaceRoot);

  if (realResolved !== undefined) {
    checkRealPath(
      realResolved,
      workspaceRoot,
      realWorkspaceRoot,
      options.backupRoot,
      allowHiddenPaths,
    );
  } else if (options.validateExistingParent === true) {
    const realParent = await resolveNearestExistingParent(absolutePath, workspaceRoot);

    if (realParent === undefined) {
      throw new TextEditorPathError('not_found', 'Workspace root does not exist.');
    }

    checkRealPath(
      realParent,
      workspaceRoot,
      realWorkspaceRoot,
      options.backupRoot,
      allowHiddenPaths,
    );
  } else if (options.mustExist === true) {
    throw new TextEditorPathError('not_found', 'Path does not exist.');
  }

  return { absolutePath, relativeFromRoot };
}

export function defaultBackupRoot(workspaceRoot: string): string {
  return path.resolve(workspaceRoot, DEFAULT_BACKUP_DIRNAME);
}
