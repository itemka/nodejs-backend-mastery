import type {
  ChatMessage,
  LlmProvider,
  LlmRequest,
  LlmResponse,
} from '@workspaces/packages/llm-client';
import { describe, expect, it, vi } from 'vitest';

import { createChatService } from '../../src/chat/service.js';
import type { Messages, ToolEvent } from '../../src/chat/types.js';
import { DEFAULT_MODEL } from '../../src/config/env.js';
import type { AppTool, AppToolExecutionContext } from '../../src/tools/types.js';

const noop = (): null => null;

function createFakeProvider(text: string): {
  calls: LlmRequest[];
  provider: LlmProvider;
} {
  const calls: LlmRequest[] = [];
  const provider: LlmProvider = {
    createMessage(request) {
      calls.push({ ...request, messages: request.messages.map((m) => ({ ...m })) });

      const response: LlmResponse = { raw: { text }, text };

      return Promise.resolve(response);
    },
  };

  return { calls, provider };
}

function cloneMessage(message: ChatMessage): ChatMessage {
  return {
    content:
      typeof message.content === 'string'
        ? message.content
        : message.content.map((block) => ({ ...block })),
    role: message.role,
  };
}

function createSequenceProvider(responses: readonly LlmResponse[]): {
  calls: LlmRequest[];
  provider: LlmProvider;
} {
  const calls: LlmRequest[] = [];
  const remainingResponses = [...responses];
  const provider: LlmProvider = {
    createMessage(request) {
      calls.push({
        ...request,
        messages: request.messages.map((message) => cloneMessage(message)),
      });

      const response = remainingResponses.shift();

      if (response === undefined) {
        throw new Error('No fake response configured');
      }

      return Promise.resolve(response);
    },
  };

  return { calls, provider };
}

describe('chat service', () => {
  it('appends user and assistant turns and forwards model and tokens', async () => {
    const messages: Messages = [];
    const { calls, provider } = createFakeProvider('Hi');

    const service = createChatService({ model: DEFAULT_MODEL, provider });
    const answer = await service.sendUserTurn(messages, 'Hello', { maxTokens: 100 });

    expect(answer).toBe('Hi');
    expect(messages).toEqual([
      { content: 'Hello', role: 'user' },
      { content: 'Hi', role: 'assistant' },
    ]);
    expect(calls).toEqual([
      {
        maxTokens: 100,
        messages: [{ content: 'Hello', role: 'user' }],
        model: DEFAULT_MODEL,
        stream: true,
      },
    ]);
  });

  it('forwards a configured system prompt to the provider', async () => {
    const messages: Messages = [];
    const { calls, provider } = createFakeProvider('Hi');

    const service = createChatService({
      model: DEFAULT_MODEL,
      provider,
      systemPrompt: 'Answer like a senior backend mentor.',
    });

    await service.sendUserTurn(messages, 'Hello');

    expect(calls[0]).toMatchObject({
      systemPrompt: 'Answer like a senior backend mentor.',
    });
  });

  it('forwards a configured temperature to the provider', async () => {
    const messages: Messages = [];
    const { calls, provider } = createFakeProvider('Hi');

    const service = createChatService({
      model: DEFAULT_MODEL,
      provider,
      temperature: 0.2,
    });

    await service.sendUserTurn(messages, 'Hello');

    expect(calls[0]).toMatchObject({
      temperature: 0.2,
    });
  });

  it('forwards streaming options to the provider', async () => {
    const messages: Messages = [];
    const { calls, provider } = createFakeProvider('Hi');
    const onTextDelta = vi.fn();

    const service = createChatService({ model: DEFAULT_MODEL, provider });
    await service.sendUserTurn(messages, 'Hello', { onTextDelta, stream: false });

    expect(calls[0]).toMatchObject({
      onTextDelta,
      stream: false,
    });
  });

  it('forwards output format options to the provider', async () => {
    const messages: Messages = [];
    const { calls, provider } = createFakeProvider('{"commands":[]}');

    const service = createChatService({ model: DEFAULT_MODEL, provider });
    await service.sendUserTurn(messages, 'Give me three git commands', {
      outputFormat: {
        instructions:
          'Return the response as JSON only. Use this shape when returning commands: {"commands":["..."]}. Do not include comments, markdown fences, or explanation.',
      },
    });

    expect(calls[0]).toMatchObject({
      outputFormat: {
        instructions:
          'Return the response as JSON only. Use this shape when returning commands: {"commands":["..."]}. Do not include comments, markdown fences, or explanation.',
      },
    });
  });

  it('uses the default max tokens when no per-turn value is given', async () => {
    const messages: Messages = [];
    const { calls, provider } = createFakeProvider('ok');

    const service = createChatService({ model: 'm', provider });
    await service.sendUserTurn(messages, 'hi');

    expect(calls[0]?.maxTokens).toBe(1000);
  });

  it('logs the raw response when debugResponse is set', async () => {
    const logSpy = vi.spyOn(console, 'log').mockImplementation(noop);
    const messages: Messages = [];
    const { provider } = createFakeProvider('ok');

    const service = createChatService({ model: 'm', provider });
    await service.sendUserTurn(messages, 'hi', { debugResponse: true });

    expect(logSpy).toHaveBeenCalledWith('Full response:', { text: 'ok' });
    logSpy.mockRestore();
  });

  it('runs a Claude tool loop and sends tool results back to the provider', async () => {
    const messages: Messages = [];
    const events: ToolEvent[] = [];
    const tool: AppTool = {
      definition: {
        description: 'Get the current date and time.',
        inputSchema: { type: 'object' },
        name: 'get_current_datetime',
      },
      execute: vi.fn().mockReturnValue({ iso_datetime: '2026-05-04T12:00:00.000Z' }),
    };
    const toolContext: AppToolExecutionContext = {
      now: () => new Date('2026-05-04T12:00:00.000Z'),
      reminderStore: { reminders: [] },
    };
    const { calls, provider } = createSequenceProvider([
      {
        content: [
          {
            id: 'toolu_1',
            input: {},
            name: 'get_current_datetime',
            type: 'tool_use',
          },
        ],
        raw: { stop_reason: 'tool_use' },
        stopReason: 'tool_use',
        text: '',
      },
      {
        content: [{ text: 'It is noon.', type: 'text' }],
        raw: { stop_reason: 'end_turn' },
        stopReason: 'end_turn',
        text: 'It is noon.',
      },
    ]);

    const service = createChatService({
      model: DEFAULT_MODEL,
      provider,
      toolContext,
      tools: [tool],
    });
    const answer = await service.sendUserTurn(messages, 'What time is it?', {
      onToolEvent: (event) => {
        events.push(event);
      },
      toolsEnabled: true,
    });

    expect(answer).toBe('It is noon.');
    expect(tool.execute).toHaveBeenCalledWith({}, toolContext);
    expect(events).toEqual([
      { toolName: 'get_current_datetime', type: 'tool_requested' },
      { toolName: 'get_current_datetime', type: 'tool_running' },
      { toolName: 'get_current_datetime', type: 'tool_succeeded' },
      { count: 1, type: 'tool_results_submitted' },
      { type: 'final_response_received' },
    ]);
    expect(calls[0]).toMatchObject({
      maxTokens: 1000,
      model: DEFAULT_MODEL,
      stream: false,
      tools: [tool.definition],
    });
    expect(calls[1]?.messages).toEqual([
      { content: 'What time is it?', role: 'user' },
      {
        content: [
          {
            id: 'toolu_1',
            input: {},
            name: 'get_current_datetime',
            type: 'tool_use',
          },
        ],
        role: 'assistant',
      },
      {
        content: [
          {
            content: '{"iso_datetime":"2026-05-04T12:00:00.000Z"}',
            tool_use_id: 'toolu_1',
            type: 'tool_result',
          },
        ],
        role: 'user',
      },
    ]);
    expect(messages).toEqual([
      { content: 'What time is it?', role: 'user' },
      {
        content: [
          {
            id: 'toolu_1',
            input: {},
            name: 'get_current_datetime',
            type: 'tool_use',
          },
        ],
        role: 'assistant',
      },
      {
        content: [
          {
            content: '{"iso_datetime":"2026-05-04T12:00:00.000Z"}',
            tool_use_id: 'toolu_1',
            type: 'tool_result',
          },
        ],
        role: 'user',
      },
      { content: 'It is noon.', role: 'assistant' },
    ]);
  });

  it('groups multiple tool results into one user message', async () => {
    const messages: Messages = [];
    const tool: AppTool = {
      definition: {
        inputSchema: { type: 'object' },
        name: 'echo_tool',
      },
      execute: vi.fn().mockImplementation((input: unknown) => ({ input })),
    };
    const { provider } = createSequenceProvider([
      {
        content: [
          { id: 'toolu_1', input: { value: 1 }, name: 'echo_tool', type: 'tool_use' },
          { id: 'toolu_2', input: { value: 2 }, name: 'echo_tool', type: 'tool_use' },
        ],
        raw: {},
        stopReason: 'tool_use',
        text: '',
      },
      { raw: {}, stopReason: 'end_turn', text: 'done' },
    ]);

    const service = createChatService({ model: DEFAULT_MODEL, provider, tools: [tool] });
    await service.sendUserTurn(messages, 'Run both', { toolsEnabled: true });

    expect(messages[2]).toEqual({
      content: [
        {
          content: '{"input":{"value":1}}',
          tool_use_id: 'toolu_1',
          type: 'tool_result',
        },
        {
          content: '{"input":{"value":2}}',
          tool_use_id: 'toolu_2',
          type: 'tool_result',
        },
      ],
      role: 'user',
    });
  });

  it('enforces the max tool round guard', async () => {
    const messages: Messages = [];
    const tool: AppTool = {
      definition: {
        inputSchema: { type: 'object' },
        name: 'loop_tool',
      },
      execute: () => ({}),
    };
    const { provider } = createSequenceProvider([
      {
        content: [{ id: 'toolu_1', input: {}, name: 'loop_tool', type: 'tool_use' }],
        raw: {},
        stopReason: 'tool_use',
        text: '',
      },
      {
        content: [{ id: 'toolu_2', input: {}, name: 'loop_tool', type: 'tool_use' }],
        raw: {},
        stopReason: 'tool_use',
        text: '',
      },
    ]);

    const service = createChatService({ model: DEFAULT_MODEL, provider, tools: [tool] });

    await expect(
      service.sendUserTurn(messages, 'Loop', { maxToolRounds: 1, toolsEnabled: true }),
    ).rejects.toThrow(/maximum round limit/);
  });
});
