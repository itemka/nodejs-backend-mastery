import { describe, expect, it } from 'vitest';

import { mcpPromptToChatMessages } from '../../src/chat/prompt-converter.js';
import type { McpGetPromptResult } from '../../src/client/mcp-client.js';

function textPrompt(role: 'user' | 'assistant', text: string): McpGetPromptResult['messages'][0] {
  return {
    content: { text, type: 'text' },
    role,
  };
}

describe('prompt converter', () => {
  it('converts text prompt messages to ChatMessage values', () => {
    const result = {
      messages: [textPrompt('user', 'hello'), textPrompt('assistant', 'hi')],
    } as unknown as McpGetPromptResult;

    expect(mcpPromptToChatMessages(result)).toEqual([
      { content: 'hello', role: 'user' },
      { content: 'hi', role: 'assistant' },
    ]);
  });

  it('skips non-text prompt content', () => {
    const result = {
      messages: [
        textPrompt('user', 'first'),
        {
          content: { data: 'AA==', mimeType: 'image/png', type: 'image' },
          role: 'user',
        },
      ],
    } as unknown as McpGetPromptResult;

    expect(mcpPromptToChatMessages(result)).toEqual([{ content: 'first', role: 'user' }]);
  });
});
