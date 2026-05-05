import { describe, expect, it } from 'vitest';

import { findToolByName, llmChatTools } from '../../src/tools/registry.js';

describe('tool registry', () => {
  it('contains exactly the v1 tools', () => {
    expect(llmChatTools.map((tool) => tool.definition.name)).toEqual([
      'get_current_datetime',
      'add_duration_to_datetime',
      'set_reminder',
    ]);
  });

  it('finds tools by exact name', () => {
    expect(findToolByName(llmChatTools, 'set_reminder')?.definition.name).toBe('set_reminder');
    expect(findToolByName(llmChatTools, 'Set_Reminder')).toBeUndefined();
    expect(findToolByName(llmChatTools, 'missing')).toBeUndefined();
  });
});
