import type { LlmToolUseBlock } from '@workspaces/packages/llm-client';
import { describe, expect, it } from 'vitest';

import { createMcpToolManager } from '../../src/chat/mcp-tool-manager.js';
import type { McpCallToolResult, McpStdioClient, McpTool } from '../../src/client/mcp-client.js';

function fakeTool(name: string, description: string): McpTool {
  return {
    description,
    inputSchema: {
      properties: { value: { type: 'string' } },
      required: ['value'],
      type: 'object',
    },
    name,
  };
}

function fakeClient(
  name: string,
  tools: readonly McpTool[],
  callResult: (toolName: string, args: Record<string, unknown>) => McpCallToolResult,
): { calls: { args: Record<string, unknown>; name: string }[]; client: McpStdioClient } {
  const calls: { args: Record<string, unknown>; name: string }[] = [];
  void name;

  const client: McpStdioClient = {
    callTool: (toolName, args) => {
      calls.push({ args, name: toolName });

      return Promise.resolve(callResult(toolName, args));
    },
    close: () => Promise.resolve(),
    getPrompt: () =>
      Promise.resolve({ messages: [] } as unknown as Awaited<
        ReturnType<McpStdioClient['getPrompt']>
      >),
    listPrompts: () => Promise.resolve([]),
    listResources: () => Promise.resolve([]),
    listResourceTemplates: () => Promise.resolve([]),
    listTools: () => Promise.resolve(tools),
    readResource: () =>
      Promise.resolve({
        contents: [],
      } as unknown as Awaited<ReturnType<McpStdioClient['readResource']>>),
  };

  return { calls, client };
}

describe('mcp tool manager', () => {
  it('converts MCP tools to LLM tool definitions', async () => {
    const { client } = fakeClient('docs', [fakeTool('greet', 'Say hi')], () => ({
      content: [{ text: 'ok', type: 'text' }],
    }));

    const manager = await createMcpToolManager({ clients: [{ client, name: 'docs' }] });
    const defs = manager.toolDefinitions();

    expect(defs).toEqual([
      {
        description: 'Say hi',
        inputSchema: {
          properties: { value: { type: 'string' } },
          required: ['value'],
          type: 'object',
        },
        name: 'greet',
      },
    ]);
  });

  it('routes tool calls to the owning client and returns text content', async () => {
    const { calls, client } = fakeClient('docs', [fakeTool('greet', 'Say hi')], (name, args) => ({
      content: [{ text: `hi ${String(args.value)}`, type: 'text' }],
      structuredContent: { received: name },
    }));

    const manager = await createMcpToolManager({ clients: [{ client, name: 'docs' }] });
    const toolUse: LlmToolUseBlock = {
      id: 'use-1',
      input: { value: 'there' },
      name: 'greet',
      type: 'tool_use',
    };

    const result = await manager.callTool(toolUse);

    expect(result).toEqual({
      content: 'hi there',
      tool_use_id: 'use-1',
      type: 'tool_result',
    });
    expect(calls).toEqual([{ args: { value: 'there' }, name: 'greet' }]);
  });

  it('preserves is_error when MCP reports an error', async () => {
    const { client } = fakeClient('docs', [fakeTool('greet', 'Say hi')], () => ({
      content: [{ text: 'boom', type: 'text' }],
      isError: true,
    }));

    const manager = await createMcpToolManager({ clients: [{ client, name: 'docs' }] });
    const toolUse: LlmToolUseBlock = {
      id: 'use-2',
      input: { value: 'x' },
      name: 'greet',
      type: 'tool_use',
    };

    const result = await manager.callTool(toolUse);

    expect(result.is_error).toBe(true);
    expect(result.content).toBe('boom');
  });

  it('returns is_error=true for an unknown tool', async () => {
    const { client } = fakeClient('docs', [fakeTool('greet', 'Say hi')], () => ({
      content: [{ text: 'ok', type: 'text' }],
    }));

    const manager = await createMcpToolManager({ clients: [{ client, name: 'docs' }] });
    const toolUse: LlmToolUseBlock = {
      id: 'use-3',
      input: {},
      name: 'unknown',
      type: 'tool_use',
    };

    const result = await manager.callTool(toolUse);

    expect(result.is_error).toBe(true);
    expect(result.content).toContain('Unknown MCP tool');
  });

  it('rejects duplicate tool names across clients', async () => {
    const a = fakeClient('a', [fakeTool('shared', 'A')], () => ({
      content: [{ text: 'a', type: 'text' }],
    }));
    const b = fakeClient('b', [fakeTool('shared', 'B')], () => ({
      content: [{ text: 'b', type: 'text' }],
    }));

    await expect(
      createMcpToolManager({
        clients: [
          { client: a.client, name: 'a' },
          { client: b.client, name: 'b' },
        ],
      }),
    ).rejects.toThrow(/registered by more than one server/);
  });
});
