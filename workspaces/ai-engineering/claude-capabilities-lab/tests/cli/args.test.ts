import { describe, expect, it } from 'vitest';

import { getBoolean, getInt, getString, parseFlags } from '../../src/cli/args.js';

describe('parseFlags', () => {
  it('collects positional arguments', () => {
    const parsed = parseFlags(['thinking', '--prompt=hi', '--show-thinking']);
    expect(parsed.positionals).toEqual(['thinking']);
    expect(getString(parsed, 'prompt')).toBe('hi');
    expect(getBoolean(parsed, 'show-thinking')).toBe(true);
  });

  it('accepts repeated --image flags', () => {
    const parsed = parseFlags(['image', '--image=a.png', '--image=b.jpg']);
    expect(parsed.multi.get('image')).toEqual(['a.png', 'b.jpg']);
  });

  it('parses integer flags', () => {
    const parsed = parseFlags(['thinking', '--max-tokens=2048']);
    expect(getInt(parsed, 'max-tokens')).toBe(2048);
  });

  it('rejects non-positive integer flags', () => {
    const parsed = parseFlags(['thinking', '--max-tokens=-1']);
    expect(() => getInt(parsed, 'max-tokens')).toThrow(/positive integer/);
  });
});
