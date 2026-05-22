import type {
  LlmProvider,
  LlmRequest,
  LlmResponse,
  LlmToolResultBlock,
  LlmToolUseBlock,
} from '@workspaces/packages/llm-client';
import { describe, expect, it } from 'vitest';

import { createChatSession } from '../../src/chat/chat-session.js';
import type { McpToolManager } from '../../src/chat/mcp-tool-manager.js';

function fakeProvider(responses: readonly LlmResponse[]): {
  calls: LlmRequest[];
  provider: LlmProvider;
} {
  const calls: LlmRequest[] = [];
  const remaining = [...responses];
  const provider: LlmProvider = {
    createMessage: (request) => {
      calls.push(request);
      const response = remaining.shift();

      if (response === undefined) {
        throw new Error('No fake response configured');
      }

      return Promise.resolve(response);
    },
  };

  return { calls, provider };
}

function fakeToolManager(toolResults: Map<string, LlmToolResultBlock>): {
  invocations: LlmToolUseBlock[];
  manager: McpToolManager;
} {
  const invocations: LlmToolUseBlock[] = [];
  const manager: McpToolManager = {
    callTool: (toolUse) => {
      invocations.push(toolUse);
      const result = toolResults.get(toolUse.name);

      if (result === undefined) {
        return Promise.resolve({
          content: `no result for ${toolUse.name}`,
          is_error: true,
          tool_use_id: toolUse.id,
          type: 'tool_result',
        });
      }

      return Promise.resolve({ ...result, tool_use_id: toolUse.id });
    },
    clients: [],
    toolDefinitions: () => [
      {
        description: 'fake tool',
        inputSchema: { type: 'object' },
        name: 'do_thing',
      },
    ],
  };

  return { invocations, manager };
}

describe('chat session', () => {
  it('appends user and assistant turns and returns assistant text', async () => {
    const { calls, provider } = fakeProvider([{ raw: {}, stopReason: 'end_turn', text: 'Hi' }]);
    const { manager } = fakeToolManager(new Map());
    const session = createChatSession({ model: 'm', provider, toolManager: manager });

    const answer = await session.sendUserMessage('Hello');

    expect(answer).toBe('Hi');
    expect(session.history).toEqual([
      { content: 'Hello', role: 'user' },
      { content: [{ text: 'Hi', type: 'text' }], role: 'assistant' },
    ]);
    expect(calls[0]?.tools?.length).toBe(1);
  });

  it('runs MCP tools and submits tool_result blocks in the right order', async () => {
    const toolUseBlock: LlmToolUseBlock = {
      id: 'use-1',
      input: { x: 1 },
      name: 'do_thing',
      type: 'tool_use',
    };
    const { provider } = fakeProvider([
      {
        content: [toolUseBlock],
        raw: {},
        stopReason: 'tool_use',
        text: '',
      },
      { raw: {}, stopReason: 'end_turn', text: 'Done.' },
    ]);
    const results = new Map<string, LlmToolResultBlock>([
      ['do_thing', { content: 'tool reply', tool_use_id: 'placeholder', type: 'tool_result' }],
    ]);
    const { invocations, manager } = fakeToolManager(results);
    const session = createChatSession({ model: 'm', provider, toolManager: manager });

    const answer = await session.sendUserMessage('please');

    expect(answer).toBe('Done.');
    expect(invocations).toHaveLength(1);

    const assistantToolUseTurn = session.history[1];
    const userToolResultTurn = session.history[2];
    const finalAssistantTurn = session.history[3];

    expect(assistantToolUseTurn?.role).toBe('assistant');
    expect(userToolResultTurn?.role).toBe('user');
    expect(userToolResultTurn?.content).toEqual([
      { content: 'tool reply', tool_use_id: 'use-1', type: 'tool_result' },
    ]);
    expect(finalAssistantTurn?.role).toBe('assistant');
  });

  it('throws when tool rounds exceed the maximum', async () => {
    const toolUseBlock: LlmToolUseBlock = {
      id: 'use-1',
      input: {},
      name: 'do_thing',
      type: 'tool_use',
    };
    const { provider } = fakeProvider([
      { content: [toolUseBlock], raw: {}, stopReason: 'tool_use', text: '' },
      { content: [toolUseBlock], raw: {}, stopReason: 'tool_use', text: '' },
    ]);
    const results = new Map<string, LlmToolResultBlock>([
      ['do_thing', { content: 'ok', tool_use_id: 'placeholder', type: 'tool_result' }],
    ]);
    const { manager } = fakeToolManager(results);
    const session = createChatSession({ model: 'm', provider, toolManager: manager });

    await expect(session.sendUserMessage('go', { maxToolRounds: 1 })).rejects.toThrow(
      /maximum round limit/,
    );
  });

  it('continues after pause_turn responses before returning final text', async () => {
    const { provider } = fakeProvider([
      { raw: {}, stopReason: 'pause_turn', text: 'Partial.' },
      { raw: {}, stopReason: 'end_turn', text: 'Done.' },
    ]);
    const { manager } = fakeToolManager(new Map());
    const session = createChatSession({ model: 'm', provider, toolManager: manager });

    const answer = await session.sendUserMessage('continue');

    expect(answer).toBe('Done.');
    expect(session.history).toEqual([
      { content: 'continue', role: 'user' },
      { content: [{ text: 'Partial.', type: 'text' }], role: 'assistant' },
      { content: [{ text: 'Done.', type: 'text' }], role: 'assistant' },
    ]);
  });

  it('throws when pause_turn continuation exceeds the maximum', async () => {
    const responses = Array.from({ length: 6 }, () => ({
      raw: {},
      stopReason: 'pause_turn',
      text: 'Partial.',
    }));
    const { provider } = fakeProvider(responses);
    const { manager } = fakeToolManager(new Map());
    const session = createChatSession({ model: 'm', provider, toolManager: manager });

    await expect(session.sendUserMessage('continue')).rejects.toThrow(/pause_turn/);
  });
});
