import type { TextEditorToolInput } from './types.js';

export class TextEditorInputError extends Error {
  readonly code = 'invalid_input';

  constructor(message: string) {
    super(message);
    this.name = 'TextEditorInputError';
  }
}

function asRecord(input: unknown): Record<string, unknown> {
  if (input === null || typeof input !== 'object' || Array.isArray(input)) {
    throw new TextEditorInputError('Tool input must be a JSON object.');
  }

  return input as Record<string, unknown>;
}

function requireString(value: unknown, field: string): string {
  if (typeof value !== 'string') {
    throw new TextEditorInputError(`${field} must be a string.`);
  }

  return value;
}

function requireInteger(value: unknown, field: string): number {
  if (typeof value !== 'number' || !Number.isInteger(value)) {
    throw new TextEditorInputError(`${field} must be an integer.`);
  }

  return value;
}

function parseViewRange(value: unknown): readonly [number, number] | undefined {
  if (value === undefined) {
    return undefined;
  }

  if (!Array.isArray(value) || value.length !== 2) {
    throw new TextEditorInputError('view_range must be a [start, end] array of two integers.');
  }

  const start = requireInteger(value[0], 'view_range[0]');
  const end = requireInteger(value[1], 'view_range[1]');

  if (start < 1) {
    throw new TextEditorInputError('view_range[0] must be a positive integer.');
  }

  if (end !== -1 && end < start) {
    throw new TextEditorInputError('view_range[1] must be >= view_range[0] or -1 for end of file.');
  }

  return [start, end] as const;
}

export function parseTextEditorInput(rawInput: unknown): TextEditorToolInput {
  const record = asRecord(rawInput);
  const command = requireString(record.command, 'command');

  if (command === 'view') {
    const filePath = requireString(record.path, 'path');
    const viewRange = parseViewRange(record.view_range);

    return viewRange === undefined
      ? { command: 'view', path: filePath }
      : { command: 'view', path: filePath, view_range: viewRange };
  }

  if (command === 'create') {
    const filePath = requireString(record.path, 'path');
    const fileText = requireString(record.file_text, 'file_text');

    return { command: 'create', file_text: fileText, path: filePath };
  }

  if (command === 'str_replace') {
    const filePath = requireString(record.path, 'path');
    const oldStr = requireString(record.old_str, 'old_str');
    const newStr = requireString(record.new_str, 'new_str');

    return { command: 'str_replace', new_str: newStr, old_str: oldStr, path: filePath };
  }

  if (command === 'insert') {
    const filePath = requireString(record.path, 'path');
    const insertLine = requireInteger(record.insert_line, 'insert_line');

    if (insertLine < 0) {
      throw new TextEditorInputError('insert_line must be >= 0.');
    }

    const insertText = requireString(record.insert_text, 'insert_text');

    return { command: 'insert', insert_line: insertLine, insert_text: insertText, path: filePath };
  }

  if (command === 'undo_edit') {
    throw new TextEditorInputError(
      'undo_edit is not supported. Restore from .llm-chat-edit-backups manually if needed.',
    );
  }

  throw new TextEditorInputError(`Unknown command: ${command}.`);
}
