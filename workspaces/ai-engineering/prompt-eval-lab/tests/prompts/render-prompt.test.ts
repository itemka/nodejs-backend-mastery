import { describe, expect, it } from 'vitest';

import { renderPrompt } from '../../src/prompts/render-prompt.js';

describe('renderPrompt', () => {
  it('substitutes a single placeholder', () => {
    expect(renderPrompt('Hello, {{name}}!', { name: 'world' })).toBe('Hello, world!');
  });

  it('substitutes the same placeholder multiple times', () => {
    expect(renderPrompt('{{x}} + {{x}} = ?', { x: '2' })).toBe('2 + 2 = ?');
  });

  it('tolerates whitespace inside placeholder braces', () => {
    expect(renderPrompt('Task: {{ task }}', { task: 'go' })).toBe('Task: go');
  });

  it('throws when a referenced variable is missing', () => {
    expect(() => renderPrompt('{{missing}}', {})).toThrow(/Missing template variable: missing/);
  });

  it('returns the original string when there are no placeholders', () => {
    expect(renderPrompt('plain text', {})).toBe('plain text');
  });
});
