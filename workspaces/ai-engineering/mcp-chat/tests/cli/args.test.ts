import { describe, expect, it } from 'vitest';

import { parseArgs } from '../../src/cli/args.js';

describe('parseArgs', () => {
  it('defaults to streaming on and dist server', () => {
    expect(parseArgs([])).toEqual({
      shouldPrintHelp: false,
      stream: true,
      useDevServer: false,
    });
  });

  it('parses --no-stream', () => {
    expect(parseArgs(['--no-stream']).stream).toBe(false);
  });

  it('parses --server-dev', () => {
    expect(parseArgs(['--server-dev']).useDevServer).toBe(true);
  });

  it('parses --max-tokens with a numeric argument', () => {
    expect(parseArgs(['--max-tokens', '256']).maxTokens).toBe(256);
  });

  it('throws for --max-tokens without a value', () => {
    expect(() => parseArgs(['--max-tokens'])).toThrow(/requires a numeric argument/);
  });

  it('throws for non-positive --max-tokens values', () => {
    expect(() => parseArgs(['--max-tokens', '0'])).toThrow(/positive integer/);
  });

  it('throws for partial --max-tokens values', () => {
    expect(() => parseArgs(['--max-tokens', '1.5'])).toThrow(/positive integer/);
    expect(() => parseArgs(['--max-tokens', '12abc'])).toThrow(/positive integer/);
  });

  it('rejects unknown arguments', () => {
    expect(() => parseArgs(['--what'])).toThrow(/Unknown argument/);
  });

  it('treats --help and -h as help requests', () => {
    expect(parseArgs(['--help']).shouldPrintHelp).toBe(true);
    expect(parseArgs(['-h']).shouldPrintHelp).toBe(true);
  });
});
