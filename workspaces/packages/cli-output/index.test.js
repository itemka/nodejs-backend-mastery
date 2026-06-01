import { describe, expect, it } from 'vitest';

import * as theme from './index.js';

// Strip ANSI SGR codes so assertions check semantic content, not the escape
// codes (which depend on chalk's TTY/NO_COLOR/FORCE_COLOR detection at runtime).
// Built via RegExp from a string so the ESC control byte stays out of the
// source. This keeps the assertions valid even under `FORCE_COLOR=1`.
const ANSI_SGR = new RegExp(String.raw`\u001b\[\d+m`, 'g');
const stripAnsi = (value) => value.replaceAll(ANSI_SGR, '');

describe('cli-output theme', () => {
  it('exposes the documented role helpers', () => {
    for (const role of [
      'heading',
      'success',
      'warn',
      'error',
      'muted',
      'accent',
      'prefix',
      'ok',
      'fail',
    ]) {
      expect(typeof theme[role]).toBe('function');
    }
  });

  it('preserves the wrapped text content', () => {
    expect(stripAnsi(theme.heading('=== SECTION ==='))).toBe('=== SECTION ===');
    expect(stripAnsi(theme.success('done'))).toBe('done');
    expect(stripAnsi(theme.error('boom'))).toBe('boom');
  });

  it('prefixes ok/fail with status symbols', () => {
    expect(stripAnsi(theme.ok('passed'))).toBe(`${theme.symbols.success} passed`);
    expect(stripAnsi(theme.fail('broke'))).toBe(`${theme.symbols.failure} broke`);
  });

  it('exposes the status symbol map', () => {
    expect(theme.symbols).toMatchObject({ success: '✓', failure: '✗', pointer: '▶' });
  });
});
