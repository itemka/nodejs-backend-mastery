import type { Message } from '@anthropic-ai/sdk/resources/messages/messages';
import { describe, expect, it } from 'vitest';

import { textFromMessage } from '../../../src/llm/anthropic/text.js';

describe('textFromMessage', () => {
  it('joins text blocks and ignores non-text blocks', () => {
    const message = {
      content: [
        { text: 'Hello', type: 'text' },
        { name: 'tool', type: 'tool_use' },
        { text: 'world', type: 'text' },
      ],
    } as unknown as Message;

    expect(textFromMessage(message)).toBe('Hello\nworld');
  });

  it('returns an empty string when there are no text blocks', () => {
    const message = { content: [] } as unknown as Message;

    expect(textFromMessage(message)).toBe('');
  });
});
