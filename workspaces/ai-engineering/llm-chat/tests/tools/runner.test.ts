import { describe, expect, it, vi } from 'vitest';

import { executeToolUse } from '../../src/tools/runner.js';
import type { AppTool, AppToolExecutionContext } from '../../src/tools/types.js';

const context: AppToolExecutionContext = {
  now: () => new Date('2026-05-04T12:00:00.000Z'),
  reminderStore: { reminders: [] },
};

describe('tool runner', () => {
  it('returns a serialized tool result for successful executions', async () => {
    const tool: AppTool = {
      definition: {
        inputSchema: { type: 'object' },
        name: 'echo_tool',
      },
      execute: vi.fn().mockReturnValue({ ok: true }),
    };

    const result = await executeToolUse(
      { id: 'toolu_1', input: { value: 1 }, name: 'echo_tool', type: 'tool_use' },
      [tool],
      context,
    );

    expect(tool.execute).toHaveBeenCalledWith({ value: 1 }, context);
    expect(result).toEqual({
      content: '{"ok":true}',
      tool_use_id: 'toolu_1',
      type: 'tool_result',
    });
  });

  it('returns a sanitized error result for unknown tools', async () => {
    const result = await executeToolUse(
      { id: 'toolu_missing', input: {}, name: 'missing_tool', type: 'tool_use' },
      [],
      context,
    );

    expect(result).toEqual({
      content: '{"error":"Unknown tool: missing_tool."}',
      is_error: true,
      tool_use_id: 'toolu_missing',
      type: 'tool_result',
    });
  });

  it('returns an error result and does not execute the tool when inputError is set', async () => {
    const tool: AppTool = {
      definition: {
        inputSchema: { type: 'object' },
        name: 'echo_tool',
      },
      execute: vi.fn(),
    };

    const result = await executeToolUse(
      {
        id: 'toolu_bad',
        input: {},
        inputError: {
          code: 'invalid_json',
          message: 'Invalid tool input JSON received from provider.',
        },
        name: 'echo_tool',
        type: 'tool_use',
      },
      [tool],
      context,
    );

    expect(tool.execute).not.toHaveBeenCalled();
    expect(result).toEqual({
      content: '{"error":"Invalid tool input JSON received from provider."}',
      is_error: true,
      tool_use_id: 'toolu_bad',
      type: 'tool_result',
    });
  });

  it('routes a tool_use call to a matching client runtime when one is registered', async () => {
    const customTool: AppTool = {
      definition: { inputSchema: { type: 'object' }, name: 'my_tool' },
      execute: vi.fn().mockReturnValue({ ok: true }),
    };
    const clientRuntime = {
      execute: vi.fn().mockResolvedValue({
        content: '{"path":"x"}',
        tool_use_id: 'use_X',
        type: 'tool_result' as const,
      }),
      toolName: 'str_replace_based_edit_tool',
    };

    const result = await executeToolUse(
      {
        id: 'use_X',
        input: { command: 'view', path: 'x' },
        name: 'str_replace_based_edit_tool',
        type: 'tool_use',
      },
      [customTool],
      context,
      [clientRuntime],
    );

    expect(clientRuntime.execute).toHaveBeenCalledTimes(1);
    expect(customTool.execute).not.toHaveBeenCalled();
    expect(result.tool_use_id).toBe('use_X');
  });

  it('does not let client runtimes intercept normal custom tool calls', async () => {
    const customTool: AppTool = {
      definition: { inputSchema: { type: 'object' }, name: 'my_tool' },
      execute: vi.fn().mockReturnValue({ ok: true }),
    };
    const clientRuntime = {
      execute: vi.fn(),
      toolName: 'str_replace_based_edit_tool',
    };

    const result = await executeToolUse(
      { id: 'use_Y', input: {}, name: 'my_tool', type: 'tool_use' },
      [customTool],
      context,
      [clientRuntime],
    );

    expect(clientRuntime.execute).not.toHaveBeenCalled();
    expect(customTool.execute).toHaveBeenCalledOnce();
    expect(result).toEqual({
      content: '{"ok":true}',
      tool_use_id: 'use_Y',
      type: 'tool_result',
    });
  });

  it('returns a sanitized error result for thrown validation errors', async () => {
    const tool: AppTool = {
      definition: {
        inputSchema: { type: 'object' },
        name: 'bad_tool',
      },
      execute: () => {
        throw new Error('input was invalid\n    at internal stack frame');
      },
    };

    const result = await executeToolUse(
      { id: 'toolu_bad', input: {}, name: 'bad_tool', type: 'tool_use' },
      [tool],
      context,
    );

    expect(result).toEqual({
      content: '{"error":"input was invalid"}',
      is_error: true,
      tool_use_id: 'toolu_bad',
      type: 'tool_result',
    });
  });
});
