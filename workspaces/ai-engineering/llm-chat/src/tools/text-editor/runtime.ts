import type { LlmToolResultBlock, LlmToolUseBlock } from '@workspaces/packages/llm-client';
import path from 'node:path';

import { parseTextEditorInput, TextEditorInputError } from './input.js';
import {
  createFile,
  insertAtLine,
  resolveLimits,
  strReplace,
  TextEditorOperationError,
  viewPath,
} from './operations.js';
import { defaultBackupRoot, resolveSafePath, TextEditorPathError } from './path-safety.js';
import {
  createTextEditorToolDefinition,
  TEXT_EDITOR_TOOL_NAME,
  type TextEditorRuntime,
  type TextEditorRuntimeConfig,
  type TextEditorToolInput,
} from './types.js';

const MAX_ERROR_MESSAGE_LENGTH = 200;

function sanitizeErrorMessage(message: string): string {
  const firstLine = message.split('\n')[0] ?? 'Tool execution failed.';

  return firstLine.slice(0, MAX_ERROR_MESSAGE_LENGTH);
}

interface ErrorPayload {
  readonly code: string;
  readonly error: string;
}

function serializeError(error: unknown, workspaceRoot?: string): string {
  if (error instanceof TextEditorInputError) {
    return JSON.stringify({
      code: error.code,
      error: sanitizeErrorMessage(error.message),
    } satisfies ErrorPayload);
  }

  if (error instanceof TextEditorPathError) {
    const base = sanitizeErrorMessage(error.message);
    const hint =
      error.code === 'outside_workspace' && workspaceRoot !== undefined
        ? ` Workspace root: "${workspaceRoot}". Supply a path relative to this directory (e.g. "src/main.ts").`
        : '';

    return JSON.stringify({
      code: error.code,
      error: `${base}${hint}`,
    } satisfies ErrorPayload);
  }

  if (error instanceof TextEditorOperationError) {
    return JSON.stringify({
      code: error.code,
      error: sanitizeErrorMessage(error.message),
    } satisfies ErrorPayload);
  }

  const message = error instanceof Error ? error.message : 'Tool execution failed.';

  return JSON.stringify({
    code: 'tool_error',
    error: sanitizeErrorMessage(message),
  } satisfies ErrorPayload);
}

function buildErrorResult(
  toolUseId: string,
  error: unknown,
  workspaceRoot?: string,
): LlmToolResultBlock {
  return {
    content: serializeError(error, workspaceRoot),
    is_error: true,
    tool_use_id: toolUseId,
    type: 'tool_result',
  };
}

interface SuccessPayload {
  readonly backup_path?: string;
  readonly content?: string;
  readonly message: string;
  readonly path: string;
  readonly truncated?: boolean;
}

function buildSuccessResult(toolUseId: string, payload: SuccessPayload): LlmToolResultBlock {
  return {
    content: JSON.stringify(payload),
    tool_use_id: toolUseId,
    type: 'tool_result',
  };
}

function relativeBackupPath(workspaceRoot: string, backupAbsolutePath: string): string {
  return path.relative(workspaceRoot, backupAbsolutePath) || backupAbsolutePath;
}

export function createTextEditorRuntime(config: TextEditorRuntimeConfig): TextEditorRuntime {
  const workspaceRoot = path.resolve(config.workspaceRoot);
  const backupRoot = config.backupRoot ?? defaultBackupRoot(workspaceRoot);
  const limits = resolveLimits({
    ...(config.maxEditableBytes === undefined ? {} : { maxEditableBytes: config.maxEditableBytes }),
    ...(config.maxViewBytes === undefined ? {} : { maxViewBytes: config.maxViewBytes }),
    ...(config.maxViewCharacters === undefined
      ? {}
      : { maxViewCharacters: config.maxViewCharacters }),
  });
  const definition =
    config.toolDefinition ?? createTextEditorToolDefinition(config.maxViewCharacters);

  async function executeCommand(parsed: TextEditorToolInput): Promise<SuccessPayload> {
    if (parsed.command === 'view') {
      const resolved = await resolveSafePath({
        ...(config.allowHiddenPaths === undefined
          ? {}
          : { allowHiddenPaths: config.allowHiddenPaths }),
        backupRoot,
        mustExist: true,
        requestedPath: parsed.path,
        workspaceRoot,
      });
      const result = await viewPath({
        limits,
        resolved,
        ...(parsed.view_range === undefined ? {} : { viewRange: parsed.view_range }),
      });

      return {
        content: result.content,
        message: `Read ${resolved.relativeFromRoot}`,
        path: resolved.relativeFromRoot,
        ...(result.truncated ? { truncated: true } : {}),
      };
    }

    if (parsed.command === 'create') {
      const resolved = await resolveSafePath({
        ...(config.allowHiddenPaths === undefined
          ? {}
          : { allowHiddenPaths: config.allowHiddenPaths }),
        backupRoot,
        mustExist: false,
        requestedPath: parsed.path,
        validateExistingParent: true,
        workspaceRoot,
      });
      await createFile(resolved, parsed.file_text, limits);

      return {
        message: `Created ${resolved.relativeFromRoot}`,
        path: resolved.relativeFromRoot,
      };
    }

    if (parsed.command === 'str_replace') {
      const resolved = await resolveSafePath({
        ...(config.allowHiddenPaths === undefined
          ? {}
          : { allowHiddenPaths: config.allowHiddenPaths }),
        backupRoot,
        mustExist: true,
        requestedPath: parsed.path,
        workspaceRoot,
      });
      const result = await strReplace({
        backup: { backupRoot, relativeFromRoot: resolved.relativeFromRoot },
        limits,
        newStr: parsed.new_str,
        oldStr: parsed.old_str,
        resolved,
      });

      return {
        backup_path: relativeBackupPath(workspaceRoot, result.backupPath),
        message: `Replaced text in ${resolved.relativeFromRoot}`,
        path: resolved.relativeFromRoot,
      };
    }

    const resolved = await resolveSafePath({
      ...(config.allowHiddenPaths === undefined
        ? {}
        : { allowHiddenPaths: config.allowHiddenPaths }),
      backupRoot,
      mustExist: true,
      requestedPath: parsed.path,
      workspaceRoot,
    });
    const result = await insertAtLine({
      backup: { backupRoot, relativeFromRoot: resolved.relativeFromRoot },
      insertLine: parsed.insert_line,
      insertText: parsed.insert_text,
      limits,
      resolved,
    });

    return {
      backup_path: relativeBackupPath(workspaceRoot, result.backupPath),
      message: `Inserted text into ${resolved.relativeFromRoot}`,
      path: resolved.relativeFromRoot,
    };
  }

  return {
    definition,
    async execute(toolUse: LlmToolUseBlock): Promise<LlmToolResultBlock> {
      if (toolUse.inputError !== undefined) {
        return buildErrorResult(toolUse.id, new TextEditorInputError(toolUse.inputError.message));
      }

      try {
        const parsed = parseTextEditorInput(toolUse.input);
        const payload = await executeCommand(parsed);

        return buildSuccessResult(toolUse.id, payload);
      } catch (error) {
        return buildErrorResult(toolUse.id, error, workspaceRoot);
      }
    },
    toolName: TEXT_EDITOR_TOOL_NAME,
  };
}
