import type Anthropic from '@anthropic-ai/sdk';
import { describe, expect, it, vi } from 'vitest';

import { createAnthropicProvider } from '../../src/anthropic/messages-api.js';
import { DEFAULT_MODEL } from '../../src/config/env.js';

describe('code execution', () => {
  it('maps the code execution server tool definition and forwards betas', async () => {
    const create = vi.fn().mockResolvedValue({
      content: [{ text: 'done', type: 'text' }],
      stop_reason: 'end_turn',
    });
    const beta = { messages: { create } };
    const client = { beta, messages: { create: vi.fn() } } as unknown as Anthropic;

    const provider = createAnthropicProvider(client);
    await provider.createMessage({
      betas: ['files-api-2025-04-14'],
      maxTokens: 1000,
      messages: [
        {
          content: [
            { fileId: 'file_abc', type: 'container_upload' },
            { text: 'analyze the CSV', type: 'text' },
          ],
          role: 'user',
        },
      ],
      model: DEFAULT_MODEL,
      stream: false,
      tools: [
        {
          kind: 'anthropic_server',
          name: 'code_execution',
          provider: 'anthropic',
          type: 'code_execution_20250825',
        },
      ],
    });

    expect(create).toHaveBeenCalledWith(
      expect.objectContaining({
        betas: ['files-api-2025-04-14'],
        tools: [{ name: 'code_execution', type: 'code_execution_20250825' }],
      }),
    );

    const sentMessages = create.mock.calls[0]?.[0]?.messages as readonly Record<string, unknown>[];
    const content = (sentMessages[0] as { content: readonly Record<string, unknown>[] }).content;
    expect(content[0]).toEqual({ file_id: 'file_abc', type: 'container_upload' });
  });

  it('rejects container_upload blocks when betas are not supplied', async () => {
    const create = vi.fn();
    const client = { messages: { create } } as unknown as Anthropic;

    const provider = createAnthropicProvider(client);

    await expect(
      provider.createMessage({
        maxTokens: 1000,
        messages: [
          {
            content: [{ fileId: 'file_abc', type: 'container_upload' }],
            role: 'user',
          },
        ],
        model: DEFAULT_MODEL,
        stream: false,
      }),
    ).rejects.toThrow(/beta messages namespace/);
    expect(create).not.toHaveBeenCalled();
  });

  it('decodes server_tool_use names outside the supported set as unknown blocks', async () => {
    const create = vi.fn().mockResolvedValue({
      content: [
        {
          id: 'srv_1',
          input: { url: 'https://example.com' },
          name: 'web_fetch',
          type: 'server_tool_use',
        },
        { text: 'fetched', type: 'text' },
      ],
      stop_reason: 'end_turn',
    });
    const client = { messages: { create } } as unknown as Anthropic;

    const provider = createAnthropicProvider(client);
    const response = await provider.createMessage({
      maxTokens: 100,
      messages: [{ content: 'fetch a page', role: 'user' }],
      model: DEFAULT_MODEL,
      stream: false,
    });

    expect(response.content?.[0]).toEqual({
      raw: {
        id: 'srv_1',
        input: { url: 'https://example.com' },
        name: 'web_fetch',
        type: 'server_tool_use',
      },
      type: 'unknown',
    });
  });

  it('parses server_tool_use and code_execution_tool_result with file outputs', async () => {
    const create = vi.fn().mockResolvedValue({
      content: [
        {
          id: 'srv_1',
          input: { code: 'print(1)' },
          name: 'code_execution',
          type: 'server_tool_use',
        },
        {
          content: {
            content: [{ file_id: 'file_out_1', type: 'code_execution_output' }],
            return_code: 0,
            stderr: '',
            stdout: '1\n',
            type: 'code_execution_result',
          },
          tool_use_id: 'srv_1',
          type: 'code_execution_tool_result',
        },
        { text: 'Analysis complete.', type: 'text' },
      ],
      stop_reason: 'end_turn',
    });
    const beta = { messages: { create } };
    const client = { beta, messages: { create: vi.fn() } } as unknown as Anthropic;

    const provider = createAnthropicProvider(client);
    const response = await provider.createMessage({
      betas: ['files-api-2025-04-14'],
      maxTokens: 1000,
      messages: [{ content: 'go', role: 'user' }],
      model: DEFAULT_MODEL,
      stream: false,
    });

    expect(response.content).toEqual([
      {
        id: 'srv_1',
        input: { code: 'print(1)' },
        name: 'code_execution',
        type: 'server_tool_use',
      },
      {
        content: {
          content: [{ fileId: 'file_out_1', type: 'code_execution_output' }],
          returnCode: 0,
          stderr: '',
          stdout: '1\n',
          type: 'code_execution_result',
        },
        toolUseId: 'srv_1',
        type: 'code_execution_tool_result',
      },
      { text: 'Analysis complete.', type: 'text' },
    ]);
  });

  it('parses bash_code_execution_tool_result with generated file outputs', async () => {
    const create = vi.fn().mockResolvedValue({
      content: [
        {
          id: 'srv_1',
          input: { command: 'python3 plot.py' },
          name: 'bash_code_execution',
          type: 'server_tool_use',
        },
        {
          content: {
            content: [{ file_id: 'file_plot_1', type: 'bash_code_execution_output' }],
            return_code: 0,
            stderr: '',
            stdout: 'saved plot\n',
            type: 'bash_code_execution_result',
          },
          tool_use_id: 'srv_1',
          type: 'bash_code_execution_tool_result',
        },
        { text: 'Saved the plot.', type: 'text' },
      ],
      stop_reason: 'end_turn',
    });
    const beta = { messages: { create } };
    const client = { beta, messages: { create: vi.fn() } } as unknown as Anthropic;

    const provider = createAnthropicProvider(client);
    const response = await provider.createMessage({
      betas: ['files-api-2025-04-14'],
      maxTokens: 1000,
      messages: [{ content: 'make a plot', role: 'user' }],
      model: DEFAULT_MODEL,
      stream: false,
    });

    expect(response.content).toEqual([
      {
        id: 'srv_1',
        input: { command: 'python3 plot.py' },
        name: 'bash_code_execution',
        type: 'server_tool_use',
      },
      {
        content: {
          content: [{ fileId: 'file_plot_1', type: 'bash_code_execution_output' }],
          returnCode: 0,
          stderr: '',
          stdout: 'saved plot\n',
          type: 'bash_code_execution_result',
        },
        toolUseId: 'srv_1',
        type: 'bash_code_execution_tool_result',
      },
      { text: 'Saved the plot.', type: 'text' },
    ]);
  });
});
