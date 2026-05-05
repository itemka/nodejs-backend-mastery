import { describe, expect, it } from 'vitest';

import {
  addAssistantContent,
  addAssistantMessage,
  addUserMessage,
  addUserToolResultMessage,
} from '../../src/chat/history.js';
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

  it('preserves block content for tool turns', () => {
    const messages: Messages = [];

    addAssistantContent(messages, [
      { text: 'I will check.', type: 'text' },
      { id: 'toolu_1', input: {}, name: 'get_current_datetime', type: 'tool_use' },
    ]);
    addUserToolResultMessage(messages, [
      {
        content: '{"iso_datetime":"2026-05-04T12:00:00.000Z"}',
        tool_use_id: 'toolu_1',
        type: 'tool_result',
      },
    ]);

    expect(messages).toEqual([
      {
        content: [
          { text: 'I will check.', type: 'text' },
          { id: 'toolu_1', input: {}, name: 'get_current_datetime', type: 'tool_use' },
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
  });
});
