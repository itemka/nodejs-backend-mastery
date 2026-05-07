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
        webSearchEnabled: false,
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

  it('parses --tools', () => {
    expect(parseArgs(['--tools'])).toEqual({
      options: { toolsEnabled: true },
      shouldPrintHelp: false,
    });
  });

  it('rejects --tools with structured output flags', () => {
    expect(() => parseArgs(['--tools', '--output-format=json'])).toThrow(/cannot be combined/);
    expect(() => parseArgs(['--structured-commands', '--tools'])).toThrow(/cannot be combined/);
  });

  it('parses --fine-grained-tool-streaming with --tools', () => {
    expect(parseArgs(['--tools', '--fine-grained-tool-streaming'])).toEqual({
      options: { fineGrainedToolStreaming: true, toolsEnabled: true, webSearchEnabled: false },
      shouldPrintHelp: false,
    });
  });

  it('rejects --fine-grained-tool-streaming without --tools', () => {
    expect(() => parseArgs(['--fine-grained-tool-streaming'])).toThrow(/requires --tools/);
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

  it('parses --edit-files with --tools', () => {
    expect(parseArgs(['--tools', '--edit-files'])).toEqual({
      options: { editFiles: {}, toolsEnabled: true },
      shouldPrintHelp: false,
    });
  });

  it('rejects --edit-files without --tools', () => {
    expect(() => parseArgs(['--edit-files'])).toThrow(/--edit-files requires --tools/);
  });

  it('rejects --edit-files with --fine-grained-tool-streaming', () => {
    expect(() => parseArgs(['--tools', '--edit-files', '--fine-grained-tool-streaming'])).toThrow(
      /cannot be combined with --fine-grained-tool-streaming/,
    );
  });

  it('parses --workspace-root with --edit-files', () => {
    expect(parseArgs(['--tools', '--edit-files', '--workspace-root=/tmp/safe'])).toEqual({
      options: { editFiles: { workspaceRoot: '/tmp/safe' }, toolsEnabled: true },
      shouldPrintHelp: false,
    });
  });

  it('rejects empty --workspace-root', () => {
    expect(() => parseArgs(['--tools', '--edit-files', '--workspace-root='])).toThrow(
      /--workspace-root must be a non-empty path/,
    );
  });

  it('rejects --workspace-root without --edit-files', () => {
    expect(() => parseArgs(['--tools', '--workspace-root=/tmp/safe'])).toThrow(
      /--workspace-root requires --edit-files/,
    );
  });

  it('parses --text-editor-max-characters with --edit-files', () => {
    expect(parseArgs(['--tools', '--edit-files', '--text-editor-max-characters=10000'])).toEqual({
      options: {
        editFiles: { textEditorMaxCharacters: 10_000 },
        toolsEnabled: true,
      },
      shouldPrintHelp: false,
    });
  });

  it('rejects non-positive --text-editor-max-characters', () => {
    expect(() => parseArgs(['--tools', '--edit-files', '--text-editor-max-characters=0'])).toThrow(
      /positive integer/,
    );
    expect(() =>
      parseArgs(['--tools', '--edit-files', '--text-editor-max-characters=abc']),
    ).toThrow(/positive integer/);
  });

  it('rejects --text-editor-max-characters without --edit-files', () => {
    expect(() => parseArgs(['--tools', '--text-editor-max-characters=10000'])).toThrow(
      /--text-editor-max-characters requires --edit-files/,
    );
  });

  it('does not set webSearchEnabled when defaulting to enabled', () => {
    expect(parseArgs([]).options.webSearchEnabled).toBeUndefined();
    expect(parseArgs(['--tools']).options.webSearchEnabled).toBeUndefined();
  });

  it('sets webSearchEnabled to false when --no-web-search is given', () => {
    expect(parseArgs(['--no-web-search']).options.webSearchEnabled).toBe(false);
    expect(parseArgs(['--tools', '--no-web-search']).options.webSearchEnabled).toBe(false);
  });

  it('disables web search automatically with structured output formats', () => {
    expect(parseArgs(['--output-format=json']).options.webSearchEnabled).toBe(false);
    expect(parseArgs(['--output-format=csv']).options.webSearchEnabled).toBe(false);
    expect(parseArgs(['--structured-commands']).options.webSearchEnabled).toBe(false);
  });

  it('disables web search automatically with --tools --fine-grained-tool-streaming', () => {
    expect(parseArgs(['--tools', '--fine-grained-tool-streaming']).options.webSearchEnabled).toBe(
      false,
    );
  });
});

describe('helpText', () => {
  it('mentions all flags', () => {
    const text = helpText();

    expect(text).toContain('--max-tokens');
    expect(text).toContain('--debug-response');
    expect(text).toContain('--output-format');
    expect(text).toContain('--structured-commands');
    expect(text).toContain('--tools');
    expect(text).toContain('--fine-grained-tool-streaming');
    expect(text).toContain('--edit-files');
    expect(text).toContain('--workspace-root');
    expect(text).toContain('--text-editor-max-characters');
    expect(text).toContain('--no-web-search');
  });
});
