import type Anthropic from '@anthropic-ai/sdk';
import { describe, expect, it, vi } from 'vitest';

import { createAnthropicProvider } from '../../src/anthropic/messages-api.js';
import { DEFAULT_MODEL } from '../../src/config/env.js';

describe('extended thinking', () => {
  it('maps adaptive thinking config and forwards display', async () => {
    const create = vi.fn().mockResolvedValue({
      content: [{ text: 'ok', type: 'text' }],
      stop_reason: 'end_turn',
    });
    const client = { messages: { create } } as unknown as Anthropic;

    const provider = createAnthropicProvider(client);
    await provider.createMessage({
      maxTokens: 4096,
      messages: [{ content: 'reason', role: 'user' }],
      model: DEFAULT_MODEL,
      stream: false,
      thinking: { display: 'summarized', type: 'adaptive' },
    });

    expect(create).toHaveBeenCalledWith(
      expect.objectContaining({
        thinking: { display: 'summarized', type: 'adaptive' },
      }),
    );
  });

  it('maps enabled thinking with budget_tokens', async () => {
    const create = vi.fn().mockResolvedValue({
      content: [{ text: 'ok', type: 'text' }],
      stop_reason: 'end_turn',
    });
    const client = { messages: { create } } as unknown as Anthropic;

    const provider = createAnthropicProvider(client);
    await provider.createMessage({
      maxTokens: 4096,
      messages: [{ content: 'reason', role: 'user' }],
      model: DEFAULT_MODEL,
      stream: false,
      thinking: { budgetTokens: 2048, type: 'enabled' },
    });

    expect(create).toHaveBeenCalledWith(
      expect.objectContaining({
        thinking: { budget_tokens: 2048, type: 'enabled' },
      }),
    );
  });

  it('rejects budget_tokens below 1024', async () => {
    const create = vi.fn();
    const client = { messages: { create } } as unknown as Anthropic;

    const provider = createAnthropicProvider(client);

    await expect(
      provider.createMessage({
        maxTokens: 4096,
        messages: [{ content: 'reason', role: 'user' }],
        model: DEFAULT_MODEL,
        stream: false,
        thinking: { budgetTokens: 512, type: 'enabled' },
      }),
    ).rejects.toThrow(/at least 1024/);
    expect(create).not.toHaveBeenCalled();
  });

  it('rejects budget_tokens >= maxTokens', async () => {
    const create = vi.fn();
    const client = { messages: { create } } as unknown as Anthropic;

    const provider = createAnthropicProvider(client);

    await expect(
      provider.createMessage({
        maxTokens: 2048,
        messages: [{ content: 'reason', role: 'user' }],
        model: DEFAULT_MODEL,
        stream: false,
        thinking: { budgetTokens: 2048, type: 'enabled' },
      }),
    ).rejects.toThrow(/less than maxTokens/);
    expect(create).not.toHaveBeenCalled();
  });

  it('rejects thinking with temperature', async () => {
    const create = vi.fn();
    const client = { messages: { create } } as unknown as Anthropic;

    const provider = createAnthropicProvider(client);

    await expect(
      provider.createMessage({
        maxTokens: 4096,
        messages: [{ content: 'reason', role: 'user' }],
        model: DEFAULT_MODEL,
        stream: false,
        temperature: 0.2,
        thinking: { budgetTokens: 1024, type: 'enabled' },
      }),
    ).rejects.toThrow(/temperature/);
    expect(create).not.toHaveBeenCalled();
  });

  it('rejects thinking with assistant prefill', async () => {
    const create = vi.fn();
    const client = { messages: { create } } as unknown as Anthropic;

    const provider = createAnthropicProvider(client);

    await expect(
      provider.createMessage({
        maxTokens: 4096,
        messages: [{ content: 'reason', role: 'user' }],
        model: DEFAULT_MODEL,
        outputFormat: { assistantPrefill: '{' },
        stream: false,
        thinking: { budgetTokens: 1024, type: 'enabled' },
      }),
    ).rejects.toThrow(/prefill/);
    expect(create).not.toHaveBeenCalled();
  });

  it('parses thinking and redacted_thinking response blocks', async () => {
    const create = vi.fn().mockResolvedValue({
      content: [
        { signature: 'sig', thinking: 'step by step', type: 'thinking' },
        { data: 'enc', type: 'redacted_thinking' },
        { text: 'final answer', type: 'text' },
      ],
      stop_reason: 'end_turn',
    });
    const client = { messages: { create } } as unknown as Anthropic;

    const provider = createAnthropicProvider(client);
    const response = await provider.createMessage({
      maxTokens: 4096,
      messages: [{ content: 'reason', role: 'user' }],
      model: DEFAULT_MODEL,
      stream: false,
    });

    expect(response.content).toEqual([
      { signature: 'sig', thinking: 'step by step', type: 'thinking' },
      { data: 'enc', type: 'redacted_thinking' },
      { text: 'final answer', type: 'text' },
    ]);
  });

  it('round-trips thinking and redacted_thinking back to the API', async () => {
    const create = vi.fn().mockResolvedValue({
      content: [{ text: 'continued', type: 'text' }],
      stop_reason: 'end_turn',
    });
    const client = { messages: { create } } as unknown as Anthropic;

    const provider = createAnthropicProvider(client);
    await provider.createMessage({
      maxTokens: 4096,
      messages: [
        { content: 'reason', role: 'user' },
        {
          content: [
            { signature: 'sig', thinking: 'step', type: 'thinking' },
            { data: 'enc', type: 'redacted_thinking' },
            { text: 'first', type: 'text' },
          ],
          role: 'assistant',
        },
        { content: 'continue', role: 'user' },
      ],
      model: DEFAULT_MODEL,
      stream: false,
    });

    const sentMessages = create.mock.calls[0]?.[0]?.messages as readonly Record<string, unknown>[];
    const assistantContent = (sentMessages[1] as { content: readonly Record<string, unknown>[] })
      .content;
    expect(assistantContent[0]).toEqual({ signature: 'sig', thinking: 'step', type: 'thinking' });
    expect(assistantContent[1]).toEqual({ data: 'enc', type: 'redacted_thinking' });
  });
});
