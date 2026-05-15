import type Anthropic from '@anthropic-ai/sdk';
import { describe, expect, it, vi } from 'vitest';

import { createAnthropicProvider } from '../../src/anthropic/messages-api.js';
import {
  addCacheBreakpointOnLastBlock,
  addCacheBreakpointOnLastTool,
  withSystemPromptCache,
} from '../../src/anthropic/prompt-caching.js';
import { DEFAULT_MODEL } from '../../src/config/env.js';
import type { LlmRequest } from '../../src/types.js';

const baseRequest = (): LlmRequest => ({
  maxTokens: 1000,
  messages: [{ content: 'hi', role: 'user' }],
  model: DEFAULT_MODEL,
});

describe('prompt caching helpers', () => {
  it('does not mutate the original request when setting system cache', () => {
    const request: LlmRequest = { ...baseRequest(), systemPrompt: 'long system' };
    const result = withSystemPromptCache(request, { type: 'ephemeral' });

    expect(request.systemPrompt).toBe('long system');
    expect(result.systemPrompt).toEqual([
      { cacheControl: { type: 'ephemeral' }, text: 'long system', type: 'text' },
    ]);
  });

  it('marks the last tool definition with cache control', () => {
    const request: LlmRequest = {
      ...baseRequest(),
      tools: [
        { inputSchema: { type: 'object' }, name: 'tool_a' },
        { inputSchema: { type: 'object' }, name: 'tool_b' },
      ],
    };

    const result = addCacheBreakpointOnLastTool(request, { ttl: '1h', type: 'ephemeral' });

    expect(request.tools?.[1]).toEqual({ inputSchema: { type: 'object' }, name: 'tool_b' });
    expect(result.tools?.[0]).toEqual({ inputSchema: { type: 'object' }, name: 'tool_a' });
    expect(result.tools?.[1]).toEqual({
      cacheControl: { ttl: '1h', type: 'ephemeral' },
      inputSchema: { type: 'object' },
      name: 'tool_b',
    });
  });

  it('marks the last block on the last message with cache control', () => {
    const request: LlmRequest = {
      ...baseRequest(),
      messages: [
        {
          content: [
            {
              source: { data: 'd', mediaType: 'application/pdf', type: 'base64' },
              type: 'document',
            },
            { text: 'Question.', type: 'text' },
          ],
          role: 'user',
        },
      ],
    };

    const result = addCacheBreakpointOnLastBlock(request, { type: 'ephemeral' });
    const updated = result.messages[0]?.content;

    expect(Array.isArray(updated)).toBe(true);

    if (Array.isArray(updated)) {
      expect(updated[1]).toEqual({
        cacheControl: { type: 'ephemeral' },
        text: 'Question.',
        type: 'text',
      });
    }
  });

  it('sends cache_control through to Anthropic on system blocks', async () => {
    const create = vi.fn().mockResolvedValue({
      content: [{ text: 'ok', type: 'text' }],
      stop_reason: 'end_turn',
      usage: {
        cache_creation: { ephemeral_1h_input_tokens: 0, ephemeral_5m_input_tokens: 1200 },
        cache_creation_input_tokens: 1200,
        cache_read_input_tokens: 0,
        input_tokens: 50,
        output_tokens: 10,
      },
    });
    const client = { messages: { create } } as unknown as Anthropic;
    const provider = createAnthropicProvider(client);

    const response = await provider.createMessage(
      withSystemPromptCache(
        { ...baseRequest(), stream: false, systemPrompt: 'long stable instructions' },
        { type: 'ephemeral' },
      ),
    );

    expect(create).toHaveBeenCalledWith(
      expect.objectContaining({
        system: [
          {
            cache_control: { type: 'ephemeral' },
            text: 'long stable instructions',
            type: 'text',
          },
        ],
      }),
    );
    expect(response.usage).toEqual({
      cacheCreation: { ephemeral1hInputTokens: 0, ephemeral5mInputTokens: 1200 },
      cacheCreationInputTokens: 1200,
      cacheReadInputTokens: 0,
      inputTokens: 50,
      outputTokens: 10,
    });
  });
});
