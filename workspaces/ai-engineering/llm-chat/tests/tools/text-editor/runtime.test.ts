import { mkdir, mkdtemp, readFile, rm, symlink, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { createTextEditorRuntime } from '../../../src/tools/text-editor/runtime.js';

interface ResultPayload {
  readonly backup_path?: string;
  readonly content?: string;
  readonly error?: string;
  readonly code?: string;
  readonly message?: string;
  readonly path?: string;
  readonly truncated?: boolean;
}

function parseResult(content: string): ResultPayload {
  return JSON.parse(content) as ResultPayload;
}

describe('text editor runtime', () => {
  let workspaceRoot: string;

  beforeEach(async () => {
    workspaceRoot = await mkdtemp(path.join(tmpdir(), 'text-editor-test-'));
  });

  afterEach(async () => {
    await rm(workspaceRoot, { force: true, recursive: true });
  });

  describe('view', () => {
    it('reads an allowed file with line-numbered output', async () => {
      const filePath = path.join(workspaceRoot, 'note.txt');
      await writeFile(filePath, 'first\nsecond\nthird\n', 'utf8');

      const runtime = createTextEditorRuntime({ workspaceRoot });
      const result = await runtime.execute({
        id: 'use_1',
        input: { command: 'view', path: 'note.txt' },
        name: 'str_replace_based_edit_tool',
        type: 'tool_use',
      });

      expect(result.is_error).toBeUndefined();
      const payload = parseResult(result.content);
      expect(payload.path).toBe('note.txt');
      expect(payload.content).toContain('1\tfirst');
      expect(payload.content).toContain('2\tsecond');
      expect(payload.content).toContain('3\tthird');
    });

    it('supports view_range', async () => {
      const filePath = path.join(workspaceRoot, 'lines.txt');
      await writeFile(filePath, 'a\nb\nc\nd\ne\n', 'utf8');

      const runtime = createTextEditorRuntime({ workspaceRoot });
      const result = await runtime.execute({
        id: 'use_2',
        input: { command: 'view', path: 'lines.txt', view_range: [2, 4] },
        name: 'str_replace_based_edit_tool',
        type: 'tool_use',
      });

      const payload = parseResult(result.content);
      expect(payload.content).toContain('2\tb');
      expect(payload.content).toContain('3\tc');
      expect(payload.content).toContain('4\td');
      expect(payload.content).not.toContain('1\ta');
      expect(payload.content).not.toContain('5\te');
    });

    it('rejects a path outside workspace root', async () => {
      const runtime = createTextEditorRuntime({ workspaceRoot });
      const result = await runtime.execute({
        id: 'use_3',
        input: { command: 'view', path: '/etc/passwd' },
        name: 'str_replace_based_edit_tool',
        type: 'tool_use',
      });

      expect(result.is_error).toBe(true);
      expect(parseResult(result.content).code).toBe('outside_workspace');
    });

    it('rejects parent traversal', async () => {
      const runtime = createTextEditorRuntime({ workspaceRoot });
      const result = await runtime.execute({
        id: 'use_4',
        input: { command: 'view', path: '../escaped.txt' },
        name: 'str_replace_based_edit_tool',
        type: 'tool_use',
      });

      expect(result.is_error).toBe(true);
      expect(parseResult(result.content).code).toBe('outside_workspace');
    });

    it('rejects binary files', async () => {
      const filePath = path.join(workspaceRoot, 'binary.bin');
      await writeFile(filePath, Buffer.from([0x00, 0x01, 0x02, 0x03]));

      const runtime = createTextEditorRuntime({ workspaceRoot });
      const result = await runtime.execute({
        id: 'use_5',
        input: { command: 'view', path: 'binary.bin' },
        name: 'str_replace_based_edit_tool',
        type: 'tool_use',
      });

      expect(result.is_error).toBe(true);
      expect(parseResult(result.content).code).toBe('binary_file');
    });

    it('truncates large output when maxViewCharacters is set', async () => {
      const filePath = path.join(workspaceRoot, 'big.txt');
      await writeFile(filePath, 'a'.repeat(500), 'utf8');

      const runtime = createTextEditorRuntime({ maxViewCharacters: 50, workspaceRoot });
      const result = await runtime.execute({
        id: 'use_6',
        input: { command: 'view', path: 'big.txt' },
        name: 'str_replace_based_edit_tool',
        type: 'tool_use',
      });

      const payload = parseResult(result.content);
      expect(payload.truncated).toBe(true);
    });

    it('rejects symlink escapes', async () => {
      const linkPath = path.join(workspaceRoot, 'escape-link');
      await symlink('/etc/hosts', linkPath);

      const runtime = createTextEditorRuntime({ workspaceRoot });
      const result = await runtime.execute({
        id: 'use_7',
        input: { command: 'view', path: 'escape-link' },
        name: 'str_replace_based_edit_tool',
        type: 'tool_use',
      });

      expect(result.is_error).toBe(true);
      expect(parseResult(result.content).code).toBe('symlink_escape');
    });

    it('lists allowed directory contents without recursion', async () => {
      await writeFile(path.join(workspaceRoot, 'a.txt'), 'a', 'utf8');
      await mkdir(path.join(workspaceRoot, 'sub'));

      const runtime = createTextEditorRuntime({ workspaceRoot });
      const result = await runtime.execute({
        id: 'use_dir',
        input: { command: 'view', path: '.' },
        name: 'str_replace_based_edit_tool',
        type: 'tool_use',
      });

      const payload = parseResult(result.content);
      expect(payload.content).toContain('- a.txt');
      expect(payload.content).toContain('d sub');
    });
  });

  describe('create', () => {
    it('creates a file under the allowed root', async () => {
      const runtime = createTextEditorRuntime({ workspaceRoot });
      const result = await runtime.execute({
        id: 'use_c1',
        input: { command: 'create', file_text: 'hello\n', path: 'new/file.txt' },
        name: 'str_replace_based_edit_tool',
        type: 'tool_use',
      });

      expect(result.is_error).toBeUndefined();
      const onDisk = await readFile(path.join(workspaceRoot, 'new/file.txt'), 'utf8');
      expect(onDisk).toBe('hello\n');
    });

    it('refuses to overwrite an existing file', async () => {
      await writeFile(path.join(workspaceRoot, 'existing.txt'), 'old', 'utf8');

      const runtime = createTextEditorRuntime({ workspaceRoot });
      const result = await runtime.execute({
        id: 'use_c2',
        input: { command: 'create', file_text: 'new', path: 'existing.txt' },
        name: 'str_replace_based_edit_tool',
        type: 'tool_use',
      });

      expect(result.is_error).toBe(true);
      expect(parseResult(result.content).code).toBe('file_exists');
    });

    it('rejects creating hidden files by default', async () => {
      const runtime = createTextEditorRuntime({ workspaceRoot });
      const result = await runtime.execute({
        id: 'use_c3',
        input: { command: 'create', file_text: 'X', path: '.secret' },
        name: 'str_replace_based_edit_tool',
        type: 'tool_use',
      });

      expect(result.is_error).toBe(true);
      expect(parseResult(result.content).code).toBe('blocked_hidden_path');
    });

    it('rejects creating .env files even when allowHiddenPaths is true', async () => {
      const runtime = createTextEditorRuntime({ allowHiddenPaths: true, workspaceRoot });
      const result = await runtime.execute({
        id: 'use_c4',
        input: { command: 'create', file_text: 'KEY=secret', path: '.env' },
        name: 'str_replace_based_edit_tool',
        type: 'tool_use',
      });

      expect(result.is_error).toBe(true);
      expect(parseResult(result.content).code).toBe('blocked_secret_path');
    });

    it('rejects creating files through a symlinked parent outside the workspace', async () => {
      const outsideRoot = await mkdtemp(path.join(tmpdir(), 'text-editor-outside-'));

      try {
        await symlink(outsideRoot, path.join(workspaceRoot, 'outside-link'));

        const runtime = createTextEditorRuntime({ workspaceRoot });
        const result = await runtime.execute({
          id: 'use_c5',
          input: {
            command: 'create',
            file_text: 'escaped',
            path: 'outside-link/nested/escaped.txt',
          },
          name: 'str_replace_based_edit_tool',
          type: 'tool_use',
        });

        expect(result.is_error).toBe(true);
        expect(parseResult(result.content).code).toBe('symlink_escape');
        await expect(
          readFile(path.join(outsideRoot, 'nested/escaped.txt'), 'utf8'),
        ).rejects.toMatchObject({
          code: 'ENOENT',
        });
      } finally {
        await rm(outsideRoot, { force: true, recursive: true });
      }
    });
  });

  describe('str_replace', () => {
    it('replaces a single match and creates a backup', async () => {
      const filePath = path.join(workspaceRoot, 'target.txt');
      await writeFile(filePath, 'one\ntwo\nthree\n', 'utf8');

      const runtime = createTextEditorRuntime({ workspaceRoot });
      const result = await runtime.execute({
        id: 'use_s1',
        input: {
          command: 'str_replace',
          new_str: 'TWO',
          old_str: 'two',
          path: 'target.txt',
        },
        name: 'str_replace_based_edit_tool',
        type: 'tool_use',
      });

      expect(result.is_error).toBeUndefined();
      const updated = await readFile(filePath, 'utf8');
      expect(updated).toBe('one\nTWO\nthree\n');
      const payload = parseResult(result.content);
      expect(payload.backup_path).toBeDefined();

      const backupContents = await readFile(
        path.join(workspaceRoot, payload.backup_path ?? ''),
        'utf8',
      );
      expect(backupContents).toBe('one\ntwo\nthree\n');
    });

    it('fails when old_str has zero matches', async () => {
      const filePath = path.join(workspaceRoot, 'target.txt');
      await writeFile(filePath, 'abc', 'utf8');

      const runtime = createTextEditorRuntime({ workspaceRoot });
      const result = await runtime.execute({
        id: 'use_s2',
        input: {
          command: 'str_replace',
          new_str: 'NEW',
          old_str: 'xyz',
          path: 'target.txt',
        },
        name: 'str_replace_based_edit_tool',
        type: 'tool_use',
      });

      expect(result.is_error).toBe(true);
      expect(parseResult(result.content).code).toBe('no_match');
    });

    it('fails when old_str has multiple matches', async () => {
      const filePath = path.join(workspaceRoot, 'target.txt');
      await writeFile(filePath, 'foo bar foo', 'utf8');

      const runtime = createTextEditorRuntime({ workspaceRoot });
      const result = await runtime.execute({
        id: 'use_s3',
        input: {
          command: 'str_replace',
          new_str: 'baz',
          old_str: 'foo',
          path: 'target.txt',
        },
        name: 'str_replace_based_edit_tool',
        type: 'tool_use',
      });

      expect(result.is_error).toBe(true);
      expect(parseResult(result.content).code).toBe('multiple_matches');
    });
  });

  describe('insert', () => {
    it('inserts after the given line and creates a backup', async () => {
      const filePath = path.join(workspaceRoot, 'list.txt');
      await writeFile(filePath, 'a\nb\nc\n', 'utf8');

      const runtime = createTextEditorRuntime({ workspaceRoot });
      const result = await runtime.execute({
        id: 'use_i1',
        input: {
          command: 'insert',
          insert_line: 2,
          insert_text: 'middle',
          path: 'list.txt',
        },
        name: 'str_replace_based_edit_tool',
        type: 'tool_use',
      });

      expect(result.is_error).toBeUndefined();
      const updated = await readFile(filePath, 'utf8');
      expect(updated).toBe('a\nb\nmiddle\nc\n');
      expect(parseResult(result.content).backup_path).toBeDefined();
    });

    it('supports insert_line=0 for beginning of file', async () => {
      const filePath = path.join(workspaceRoot, 'list.txt');
      await writeFile(filePath, 'a\nb\n', 'utf8');

      const runtime = createTextEditorRuntime({ workspaceRoot });
      await runtime.execute({
        id: 'use_i2',
        input: { command: 'insert', insert_line: 0, insert_text: 'top', path: 'list.txt' },
        name: 'str_replace_based_edit_tool',
        type: 'tool_use',
      });

      const updated = await readFile(filePath, 'utf8');
      expect(updated).toBe('top\na\nb\n');
    });

    it('rejects insert_line beyond file length', async () => {
      const filePath = path.join(workspaceRoot, 'list.txt');
      await writeFile(filePath, 'a\nb\n', 'utf8');

      const runtime = createTextEditorRuntime({ workspaceRoot });
      const result = await runtime.execute({
        id: 'use_i3',
        input: { command: 'insert', insert_line: 10, insert_text: 'x', path: 'list.txt' },
        name: 'str_replace_based_edit_tool',
        type: 'tool_use',
      });

      expect(result.is_error).toBe(true);
      expect(parseResult(result.content).code).toBe('insert_line_out_of_bounds');
    });
  });

  describe('error handling', () => {
    it('rejects undo_edit', async () => {
      const runtime = createTextEditorRuntime({ workspaceRoot });
      const result = await runtime.execute({
        id: 'use_u1',
        input: { command: 'undo_edit', path: 'whatever' },
        name: 'str_replace_based_edit_tool',
        type: 'tool_use',
      });

      expect(result.is_error).toBe(true);
      expect(parseResult(result.content).code).toBe('invalid_input');
    });

    it('rejects unknown commands', async () => {
      const runtime = createTextEditorRuntime({ workspaceRoot });
      const result = await runtime.execute({
        id: 'use_u2',
        input: { command: 'rename', path: 'a' },
        name: 'str_replace_based_edit_tool',
        type: 'tool_use',
      });

      expect(result.is_error).toBe(true);
      expect(parseResult(result.content).code).toBe('invalid_input');
    });

    it('returns an error when inputError is set on the tool_use block', async () => {
      const runtime = createTextEditorRuntime({ workspaceRoot });
      const result = await runtime.execute({
        id: 'use_u3',
        input: {},
        inputError: { code: 'invalid_json', message: 'Invalid tool input JSON.' },
        name: 'str_replace_based_edit_tool',
        type: 'tool_use',
      });

      expect(result.is_error).toBe(true);
      expect(parseResult(result.content).code).toBe('invalid_input');
    });
  });
});
