import { describe, expect, it } from 'vitest';

import { parseFlags } from '../../src/cli/args.js';
import { resolveThinkingConfig } from '../../src/scenarios/thinking.js';

describe('resolveThinkingConfig', () => {
  it('defaults the thinking scenario to adaptive thinking', () => {
    expect(resolveThinkingConfig(parseFlags(['thinking']), 'claude-sonnet-4-6')).toEqual({
      type: 'adaptive',
    });
  });

  it('uses enabled thinking when a budget is supplied without a mode', () => {
    expect(
      resolveThinkingConfig(
        parseFlags(['thinking', '--thinking-budget-tokens=1500']),
        'claude-sonnet-4-6',
      ),
    ).toEqual({ budgetTokens: 1500, type: 'enabled' });
  });

  it('rejects manual enabled thinking for Opus 4.7 models', () => {
    expect(() =>
      resolveThinkingConfig(parseFlags(['thinking', '--thinking-mode=enabled']), 'claude-opus-4-7'),
    ).toThrow(/adaptive/);
  });
});
