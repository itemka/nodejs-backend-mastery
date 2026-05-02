import { describe, expect, it } from 'vitest';

import { helpText, parseArgs } from '../../src/cli/args.js';

const JSON_PRESET_SCHEMA = {
  additionalProperties: false,
  properties: {
    commands: {
      items: { type: 'string' },
      type: 'array',
    },
  },
  required: ['commands'],
  type: 'object',
};

describe('parseArgs', () => {
  it('returns empty options when no args are given', () => {
    expect(parseArgs([])).toEqual({ options: {}, shouldPrintHelp: false });
  });

  it('flags help for --help and -h', () => {
    expect(parseArgs(['--help']).shouldPrintHelp).toBe(true);
    expect(parseArgs(['-h']).shouldPrintHelp).toBe(true);
  });

  it('parses --debug-response, --max-tokens, and --structured-commands', () => {
    expect(parseArgs(['--debug-response', '--max-tokens=512', '--structured-commands'])).toEqual({
      options: {
        debugResponse: true,
        maxTokens: 512,
        outputFormat: {
          instructions:
            'Return the response as JSON only. Use this shape when returning commands: {"commands":["..."]}. Do not include comments, markdown fences, or explanation.',
          jsonSchema: JSON_PRESET_SCHEMA,
        },
      },
      shouldPrintHelp: false,
    });
  });

  it('parses output format presets', () => {
    expect(parseArgs(['--output-format=json']).options.outputFormat).toEqual({
      instructions:
        'Return the response as JSON only. Use this shape when returning commands: {"commands":["..."]}. Do not include comments, markdown fences, or explanation.',
      jsonSchema: JSON_PRESET_SCHEMA,
    });
    expect(parseArgs(['--output-format=csv']).options.outputFormat).toEqual({
      instructions:
        'Return the response as CSV only. Include a header row. Do not include comments, markdown fences, or explanation.',
    });
    expect(parseArgs(['--output-format=html']).options.outputFormat).toEqual({
      instructions:
        'Return the response as HTML only. Use an unordered list when listing items. Do not include comments, markdown fences, or explanation.',
    });
  });

  it('ignores the forwarded pnpm delimiter', () => {
    expect(parseArgs(['--', '--output-format=json']).options.outputFormat).toEqual({
      instructions:
        'Return the response as JSON only. Use this shape when returning commands: {"commands":["..."]}. Do not include comments, markdown fences, or explanation.',
      jsonSchema: JSON_PRESET_SCHEMA,
    });
  });

  it('rejects unsupported output formats', () => {
    expect(() => parseArgs(['--output-format=xml'])).toThrow(/json, csv, html/);
  });

  it('rejects non-positive or non-integer max tokens', () => {
    expect(() => parseArgs(['--max-tokens=0'])).toThrow(/positive integer/);
    expect(() => parseArgs(['--max-tokens=abc'])).toThrow(/positive integer/);
    expect(() => parseArgs(['--max-tokens=-5'])).toThrow(/positive integer/);
  });

  it('rejects unknown arguments', () => {
    expect(() => parseArgs(['--nope'])).toThrow(/Unknown argument/);
  });
});

describe('helpText', () => {
  it('mentions both flags', () => {
    const text = helpText();

    expect(text).toContain('--max-tokens');
    expect(text).toContain('--debug-response');
    expect(text).toContain('--output-format');
    expect(text).toContain('--structured-commands');
  });
});
