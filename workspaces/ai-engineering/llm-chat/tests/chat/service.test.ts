import type { LlmProvider, LlmRequest, LlmResponse } from '@workspaces/packages/llm-client';
import { describe, expect, it, vi } from 'vitest';

import { createChatService } from '../../src/chat/service.js';
import type { Messages } from '../../src/chat/types.js';
import { DEFAULT_MODEL } from '../../src/config/env.js';

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
});
