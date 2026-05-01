import { describe, expect, it } from 'vitest';

import { addAssistantMessage, addUserMessage } from '../../src/chat/history.js';
import type { Messages } from '../../src/chat/types.js';

describe('chat history helpers', () => {
  it('preserves conversation order', () => {
    const messages: Messages = [];

    addUserMessage(messages, 'Define quantum computing in one sentence');
    addAssistantMessage(messages, 'Quantum computing uses quantum states.');
    addUserMessage(messages, 'Write another sentence');

    expect(messages).toEqual([
      {
        content: 'Define quantum computing in one sentence',
        role: 'user',
      },
      {
        content: 'Quantum computing uses quantum states.',
        role: 'assistant',
      },
      {
        content: 'Write another sentence',
        role: 'user',
      },
    ]);
  });
});
