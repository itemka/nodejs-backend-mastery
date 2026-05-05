import type Anthropic from '@anthropic-ai/sdk';
import { describe, expect, it, vi } from 'vitest';

import { createAnthropicProvider } from '../../src/anthropic/messages-api.js';
import { DEFAULT_MODEL } from '../../src/config/env.js';

describe('createAnthropicProvider', () => {
  it('streams messages by default and extracts final text', async () => {
    const on = vi.fn().mockReturnThis();
    const finalMessage = vi.fn().mockResolvedValue({
      content: [{ text: 'Hi', type: 'text' }],
    });
    const stream = vi.fn().mockReturnValue({ finalMessage, on });
    const client = { messages: { stream } } as unknown as Anthropic;
    const onTextDelta = vi.fn();

    const provider = createAnthropicProvider(client);
    const response = await provider.createMessage({
      maxTokens: 100,
      messages: [{ content: 'Hello', role: 'user' }],
      model: DEFAULT_MODEL,
      onTextDelta,
      systemPrompt: 'Answer with short examples.',
      temperature: 0.2,
    });

    expect(response.text).toBe('Hi');
    expect(response.raw).toEqual({ content: [{ text: 'Hi', type: 'text' }] });
    expect(on).toHaveBeenCalledWith('text', onTextDelta);
    expect(stream).toHaveBeenCalledWith({
      max_tokens: 100,
      messages: [{ content: 'Hello', role: 'user' }],
      model: DEFAULT_MODEL,
      system: 'Answer with short examples.',
      temperature: 0.2,
    });
  });

  it('uses assistant prefill and stop sequences for an output format', async () => {
    const on = vi.fn().mockReturnThis();
    const finalMessage = vi.fn().mockResolvedValue({
      content: [{ text: 'pnpm install",\n    "pnpm test",\n    "pnpm build"', type: 'text' }],
    });
    const stream = vi.fn().mockReturnValue({ finalMessage, on });
    const client = { messages: { stream } } as unknown as Anthropic;
    const onTextDelta = vi.fn();

    const provider = createAnthropicProvider(client);
    const response = await provider.createMessage({
      maxTokens: 100,
      messages: [{ content: 'Give me three pnpm commands', role: 'user' }],
      model: DEFAULT_MODEL,
      onTextDelta,
      outputFormat: {
        assistantPrefill: '{\n  "commands": [\n    "',
        instructions:
          'Return the response as JSON only. Use this shape when returning commands: {"commands":["..."]}. Do not include comments, markdown fences, or explanation.',
        responseSuffix: '\n  ]\n}',
        stopSequences: ['\n  ]\n}'],
      },
    });

    expect(response.text).toBe(
      '{\n  "commands": [\n    "pnpm install",\n    "pnpm test",\n    "pnpm build"\n  ]\n}',
    );
    expect(onTextDelta).toHaveBeenNthCalledWith(1, '{\n  "commands": [\n    "');
    expect(onTextDelta).toHaveBeenLastCalledWith('\n  ]\n}');
    expect(stream).toHaveBeenCalledWith({
      max_tokens: 100,
      messages: [
        { content: 'Give me three pnpm commands', role: 'user' },
        { content: '{\n  "commands": [\n    "', role: 'assistant' },
      ],
      model: DEFAULT_MODEL,
      stop_sequences: ['\n  ]\n}'],
      system:
        'Return the response as JSON only. Use this shape when returning commands: {"commands":["..."]}. Do not include comments, markdown fences, or explanation.',
    });
  });

  it('uses output format instructions without assistant prefill', async () => {
    const on = vi.fn().mockReturnThis();
    const finalMessage = vi.fn().mockResolvedValue({
      content: [{ text: '{"commands":["aws s3 ls"]}', type: 'text' }],
    });
    const stream = vi.fn().mockReturnValue({ finalMessage, on });
    const client = { messages: { stream } } as unknown as Anthropic;

    const provider = createAnthropicProvider(client);
    const response = await provider.createMessage({
      maxTokens: 100,
      messages: [{ content: 'Give me one AWS CLI command', role: 'user' }],
      model: DEFAULT_MODEL,
      outputFormat: {
        instructions:
          'Return the response as JSON only. Use this shape when returning commands: {"commands":["..."]}. Do not include comments, markdown fences, or explanation.',
      },
    });

    expect(response.text).toBe('{"commands":["aws s3 ls"]}');
    expect(stream).toHaveBeenCalledWith({
      max_tokens: 100,
      messages: [{ content: 'Give me one AWS CLI command', role: 'user' }],
      model: DEFAULT_MODEL,
      system:
        'Return the response as JSON only. Use this shape when returning commands: {"commands":["..."]}. Do not include comments, markdown fences, or explanation.',
    });
  });

  it('uses output_config.format when jsonSchema is set and does not append assistant prefill', async () => {
    const on = vi.fn().mockReturnThis();
    const finalMessage = vi.fn().mockResolvedValue({
      content: [{ text: '{"commands":["git status"]}', type: 'text' }],
    });
    const stream = vi.fn().mockReturnValue({ finalMessage, on });
    const client = { messages: { stream } } as unknown as Anthropic;
    const onTextDelta = vi.fn();

    const provider = createAnthropicProvider(client);
    const response = await provider.createMessage({
      maxTokens: 100,
      messages: [{ content: 'Give me one git command', role: 'user' }],
      model: DEFAULT_MODEL,
      onTextDelta,
      outputFormat: {
        instructions:
          'Return the response as JSON only. Use this shape when returning commands: {"commands":["..."]}. Do not include comments, markdown fences, or explanation.',
        jsonSchema: {
          additionalProperties: false,
          properties: {
            commands: {
              items: { type: 'string' },
              type: 'array',
            },
          },
          required: ['commands'],
          type: 'object',
        },
      },
    });

    expect(response.text).toBe('{"commands":["git status"]}');
    expect(stream).toHaveBeenCalledWith({
      max_tokens: 100,
      messages: [{ content: 'Give me one git command', role: 'user' }],
      model: DEFAULT_MODEL,
      output_config: {
        format: {
          schema: {
            additionalProperties: false,
            properties: {
              commands: {
                items: { type: 'string' },
                type: 'array',
              },
            },
            required: ['commands'],
            type: 'object',
          },
          type: 'json_schema',
        },
      },
      system:
        'Return the response as JSON only. Use this shape when returning commands: {"commands":["..."]}. Do not include comments, markdown fences, or explanation.',
    });
  });

  it('can create non-streaming messages', async () => {
    const create = vi.fn().mockResolvedValue({
      content: [{ text: 'Hi', type: 'text' }],
    });
    const client = { messages: { create } } as unknown as Anthropic;

    const provider = createAnthropicProvider(client);
    const response = await provider.createMessage({
      maxTokens: 100,
      messages: [{ content: 'Hello', role: 'user' }],
      model: DEFAULT_MODEL,
      stream: false,
    });

    expect(response.text).toBe('Hi');
    expect(create).toHaveBeenCalledWith({
      max_tokens: 100,
      messages: [{ content: 'Hello', role: 'user' }],
      model: DEFAULT_MODEL,
    });
  });

  it('sends tool definitions and block-array messages, then preserves tool-use responses', async () => {
    const create = vi.fn().mockResolvedValue({
      content: [
        {
          id: 'toolu_123',
          input: { format: 'iso' },
          name: 'get_current_datetime',
          type: 'tool_use',
        },
      ],
      stop_reason: 'tool_use',
    });
    const client = { messages: { create } } as unknown as Anthropic;

    const provider = createAnthropicProvider(client);
    const response = await provider.createMessage({
      maxTokens: 100,
      messages: [
        { content: 'What time is it?', role: 'user' },
        {
          content: [
            {
              id: 'toolu_previous',
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
              tool_use_id: 'toolu_previous',
              type: 'tool_result',
            },
          ],
          role: 'user',
        },
      ],
      model: DEFAULT_MODEL,
      stream: false,
      tools: [
        {
          description: 'Get the current date and time.',
          inputExamples: [{ format: 'iso' }],
          inputSchema: {
            additionalProperties: false,
            properties: {
              format: { enum: ['iso'], type: 'string' },
            },
            required: ['format'],
            type: 'object',
          },
          name: 'get_current_datetime',
        },
      ],
    });

    expect(response.content).toEqual([
      {
        id: 'toolu_123',
        input: { format: 'iso' },
        name: 'get_current_datetime',
        type: 'tool_use',
      },
    ]);
    expect(response.stopReason).toBe('tool_use');
    expect(create).toHaveBeenCalledWith({
      max_tokens: 100,
      messages: [
        { content: 'What time is it?', role: 'user' },
        {
          content: [
            {
              id: 'toolu_previous',
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
              tool_use_id: 'toolu_previous',
              type: 'tool_result',
            },
          ],
          role: 'user',
        },
      ],
      model: DEFAULT_MODEL,
      tools: [
        {
          description: 'Get the current date and time.',
          input_examples: [{ format: 'iso' }],
          input_schema: {
            additionalProperties: false,
            properties: {
              format: { enum: ['iso'], type: 'string' },
            },
            required: ['format'],
            type: 'object',
          },
          name: 'get_current_datetime',
        },
      ],
    });
  });

  it('preserves unknown response blocks as passthrough so downstream paths fail loudly', async () => {
    const thinkingBlock = { signature: 'sig', thinking: 'reasoning...', type: 'thinking' };
    const create = vi.fn().mockResolvedValue({
      content: [thinkingBlock, { text: 'Hello', type: 'text' }],
      stop_reason: 'end_turn',
    });
    const client = { messages: { create } } as unknown as Anthropic;

    const provider = createAnthropicProvider(client);
    const response = await provider.createMessage({
      maxTokens: 100,
      messages: [{ content: 'Hi', role: 'user' }],
      model: DEFAULT_MODEL,
      stream: false,
    });

    expect(response.content).toEqual([
      { raw: thinkingBlock, type: 'unknown' },
      { text: 'Hello', type: 'text' },
    ]);
  });

  it('throws when an unknown content block is sent back to the API', async () => {
    const create = vi.fn();
    const client = { messages: { create } } as unknown as Anthropic;

    const provider = createAnthropicProvider(client);

    await expect(
      provider.createMessage({
        maxTokens: 100,
        messages: [
          {
            content: [{ raw: { type: 'thinking' }, type: 'unknown' }],
            role: 'assistant',
          },
        ],
        model: DEFAULT_MODEL,
        stream: false,
      }),
    ).rejects.toThrow(/unknown content block/);
    expect(create).not.toHaveBeenCalled();
  });
});
