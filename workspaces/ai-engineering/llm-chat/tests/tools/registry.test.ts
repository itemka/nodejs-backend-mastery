import { describe, expect, it } from 'vitest';

import { buildLlmChatTools, findToolByName, llmChatTools } from '../../src/tools/registry.js';

describe('tool registry', () => {
  it('contains exactly the v1 base tools', () => {
    expect(llmChatTools.map((tool) => tool.definition.name)).toEqual([
      'get_current_datetime',
      'add_duration_to_datetime',
      'set_reminder',
    ]);
  });

  it('returns the base tools when RAG search is not enabled', () => {
    expect(buildLlmChatTools().map((tool) => tool.definition.name)).toEqual([
      'get_current_datetime',
      'add_duration_to_datetime',
      'set_reminder',
    ]);
    expect(
      buildLlmChatTools({ ragSearchEnabled: false }).map((tool) => tool.definition.name),
    ).toEqual(['get_current_datetime', 'add_duration_to_datetime', 'set_reminder']);
  });

  it('appends search_docs only when RAG search is enabled', () => {
    expect(
      buildLlmChatTools({ ragSearchEnabled: true }).map((tool) => tool.definition.name),
    ).toEqual(['get_current_datetime', 'add_duration_to_datetime', 'set_reminder', 'search_docs']);
  });

  it('finds tools by exact name', () => {
    expect(findToolByName(llmChatTools, 'set_reminder')?.definition.name).toBe('set_reminder');
    expect(findToolByName(llmChatTools, 'Set_Reminder')).toBeUndefined();
    expect(findToolByName(llmChatTools, 'missing')).toBeUndefined();
  });
});
