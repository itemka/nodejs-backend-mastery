import type Anthropic from '@anthropic-ai/sdk';
import { describe, expect, it, vi } from 'vitest';

import { createAnthropicProvider } from '../../src/anthropic/messages-api.js';
import { DEFAULT_MODEL } from '../../src/config/env.js';

describe('image and document content blocks', () => {
  it('maps a base64 image block to ImageBlockParam', async () => {
    const create = vi.fn().mockResolvedValue({
      content: [{ text: 'image looks good', type: 'text' }],
      stop_reason: 'end_turn',
    });
    const client = { messages: { create } } as unknown as Anthropic;

    const provider = createAnthropicProvider(client);
    await provider.createMessage({
      maxTokens: 100,
      messages: [
        {
          content: [
            {
              source: { data: 'iVBORw0KGgo=', mediaType: 'image/png', type: 'base64' },
              type: 'image',
            },
            { text: 'Describe this image.', type: 'text' },
          ],
          role: 'user',
        },
      ],
      model: DEFAULT_MODEL,
      stream: false,
    });

    const sentMessages = create.mock.calls[0]?.[0]?.messages as readonly Record<string, unknown>[];
    const content = (sentMessages[0] as { content: readonly Record<string, unknown>[] }).content;
    expect(content[0]).toEqual({
      source: { data: 'iVBORw0KGgo=', media_type: 'image/png', type: 'base64' },
      type: 'image',
    });
  });

  it('maps a URL image block', async () => {
    const create = vi.fn().mockResolvedValue({
      content: [{ text: 'ok', type: 'text' }],
      stop_reason: 'end_turn',
    });
    const client = { messages: { create } } as unknown as Anthropic;

    const provider = createAnthropicProvider(client);
    await provider.createMessage({
      maxTokens: 100,
      messages: [
        {
          content: [{ source: { type: 'url', url: 'https://example.com/i.png' }, type: 'image' }],
          role: 'user',
        },
      ],
      model: DEFAULT_MODEL,
      stream: false,
    });

    const sentMessages = create.mock.calls[0]?.[0]?.messages as readonly Record<string, unknown>[];
    const content = (sentMessages[0] as { content: readonly Record<string, unknown>[] }).content;
    expect(content[0]).toEqual({
      source: { type: 'url', url: 'https://example.com/i.png' },
      type: 'image',
    });
  });

  it('maps a base64 PDF document block with title and citations enabled', async () => {
    const create = vi.fn().mockResolvedValue({
      content: [{ text: 'document summarized', type: 'text' }],
      stop_reason: 'end_turn',
    });
    const client = { messages: { create } } as unknown as Anthropic;

    const provider = createAnthropicProvider(client);
    await provider.createMessage({
      maxTokens: 100,
      messages: [
        {
          content: [
            {
              citations: { enabled: true },
              source: { data: 'JVBERi0xLjQK', mediaType: 'application/pdf', type: 'base64' },
              title: 'earth.pdf',
              type: 'document',
            },
            { text: 'Summarize in one sentence.', type: 'text' },
          ],
          role: 'user',
        },
      ],
      model: DEFAULT_MODEL,
      stream: false,
    });

    const sentMessages = create.mock.calls[0]?.[0]?.messages as readonly Record<string, unknown>[];
    const content = (sentMessages[0] as { content: readonly Record<string, unknown>[] }).content;
    expect(content[0]).toEqual({
      citations: { enabled: true },
      source: { data: 'JVBERi0xLjQK', media_type: 'application/pdf', type: 'base64' },
      title: 'earth.pdf',
      type: 'document',
    });
  });

  it('maps a plain text document block', async () => {
    const create = vi.fn().mockResolvedValue({
      content: [{ text: 'ok', type: 'text' }],
      stop_reason: 'end_turn',
    });
    const client = { messages: { create } } as unknown as Anthropic;

    const provider = createAnthropicProvider(client);
    await provider.createMessage({
      maxTokens: 100,
      messages: [
        {
          content: [
            {
              citations: { enabled: true },
              source: {
                data: 'Earth is the third planet.',
                mediaType: 'text/plain',
                type: 'text',
              },
              type: 'document',
            },
          ],
          role: 'user',
        },
      ],
      model: DEFAULT_MODEL,
      stream: false,
    });

    const sentMessages = create.mock.calls[0]?.[0]?.messages as readonly Record<string, unknown>[];
    const content = (sentMessages[0] as { content: readonly Record<string, unknown>[] }).content;
    expect(content[0]).toMatchObject({
      source: { data: 'Earth is the third planet.', media_type: 'text/plain', type: 'text' },
      type: 'document',
    });
  });

  it('parses page_location and char_location citations', async () => {
    const create = vi.fn().mockResolvedValue({
      content: [
        {
          citations: [
            {
              cited_text: 'Earth orbits the Sun.',
              document_index: 0,
              document_title: 'earth.pdf',
              end_page_number: 2,
              file_id: null,
              start_page_number: 1,
              type: 'page_location',
            },
            {
              cited_text: 'third planet',
              document_index: 1,
              document_title: 'earth.txt',
              end_char_index: 30,
              file_id: null,
              start_char_index: 9,
              type: 'char_location',
            },
          ],
          text: 'Earth is the third planet.',
          type: 'text',
        },
      ],
      stop_reason: 'end_turn',
    });
    const client = { messages: { create } } as unknown as Anthropic;

    const provider = createAnthropicProvider(client);
    const response = await provider.createMessage({
      maxTokens: 100,
      messages: [{ content: 'tell me about earth', role: 'user' }],
      model: DEFAULT_MODEL,
      stream: false,
    });

    expect(response.sources).toEqual([
      {
        citedText: 'Earth orbits the Sun.',
        documentIndex: 0,
        documentTitle: 'earth.pdf',
        kind: 'document',
        location: { endPageNumber: 2, startPageNumber: 1, type: 'page_location' },
      },
      {
        citedText: 'third planet',
        documentIndex: 1,
        documentTitle: 'earth.txt',
        kind: 'document',
        location: { endCharIndex: 30, startCharIndex: 9, type: 'char_location' },
      },
    ]);
  });

  it('rejects file-id image sources for the regular messages namespace', async () => {
    const create = vi.fn();
    const client = { messages: { create } } as unknown as Anthropic;

    const provider = createAnthropicProvider(client);

    await expect(
      provider.createMessage({
        maxTokens: 100,
        messages: [
          {
            content: [{ source: { fileId: 'file_abc', type: 'file' }, type: 'image' }],
            role: 'user',
          },
        ],
        model: DEFAULT_MODEL,
        stream: false,
      }),
    ).rejects.toThrow(/beta messages namespace/);
    expect(create).not.toHaveBeenCalled();
  });

  it('maps file-id image and document sources through the beta messages namespace', async () => {
    const create = vi.fn().mockResolvedValue({
      content: [{ text: 'ok', type: 'text' }],
      stop_reason: 'end_turn',
    });
    const client = {
      beta: { messages: { create } },
      messages: { create: vi.fn() },
    } as unknown as Anthropic;

    const provider = createAnthropicProvider(client);
    await provider.createMessage({
      betas: ['files-api-2025-04-14'],
      maxTokens: 100,
      messages: [
        {
          content: [
            { source: { fileId: 'file_image', type: 'file' }, type: 'image' },
            {
              citations: { enabled: true },
              source: { fileId: 'file_doc', type: 'file' },
              title: 'uploaded.pdf',
              type: 'document',
            },
          ],
          role: 'user',
        },
      ],
      model: DEFAULT_MODEL,
      stream: false,
    });

    const sentMessages = create.mock.calls[0]?.[0]?.messages as readonly Record<string, unknown>[];
    const content = (sentMessages[0] as { content: readonly Record<string, unknown>[] }).content;

    expect(content[0]).toEqual({
      source: { file_id: 'file_image', type: 'file' },
      type: 'image',
    });
    expect(content[1]).toEqual({
      citations: { enabled: true },
      source: { file_id: 'file_doc', type: 'file' },
      title: 'uploaded.pdf',
      type: 'document',
    });
  });
});
