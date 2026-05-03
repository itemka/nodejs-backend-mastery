import { describe, expect, it } from 'vitest';

import { helpText, parseArgs } from '../../src/cli/args.js';
import { DEFAULT_CONCURRENCY } from '../../src/eval/runner.js';
import { DEFAULT_TEMPLATE_NAME } from '../../src/prompts/templates.js';

describe('parseArgs', () => {
  it('returns help when -h is passed', () => {
    expect(parseArgs(['-h']).shouldPrintHelp).toBe(true);
    expect(parseArgs(['--help']).shouldPrintHelp).toBe(true);
  });

  it('requires --dataset', () => {
    expect(() => parseArgs([])).toThrow(/--dataset/);
  });

  it('parses --dataset with default options', () => {
    const parsed = parseArgs(['--dataset=foo.json']);

    expect(parsed.options).toEqual({
      concurrency: DEFAULT_CONCURRENCY,
      datasetPath: 'foo.json',
      templateName: DEFAULT_TEMPLATE_NAME,
    });
  });

  it('parses optional flags', () => {
    const parsed = parseArgs([
      '--dataset=foo.json',
      '--prompt=code-assistant.v1',
      '--out=report.json',
      '--model=claude-haiku-4-5',
      '--max-tokens=512',
      '--concurrency=5',
    ]);

    expect(parsed.options).toEqual({
      concurrency: 5,
      datasetPath: 'foo.json',
      maxTokens: 512,
      model: 'claude-haiku-4-5',
      outPath: 'report.json',
      templateName: 'code-assistant.v1',
    });
  });

  it('rejects an unknown prompt template', () => {
    expect(() => parseArgs(['--dataset=foo.json', '--prompt=does-not-exist'])).toThrow(
      /Unknown prompt template/,
    );
  });

  it('rejects out-of-range concurrency', () => {
    expect(() => parseArgs(['--dataset=foo.json', '--concurrency=0'])).toThrow(/concurrency/);
    expect(() => parseArgs(['--dataset=foo.json', '--concurrency=11'])).toThrow(/concurrency/);
  });

  it('rejects non-positive max-tokens', () => {
    expect(() => parseArgs(['--dataset=foo.json', '--max-tokens=0'])).toThrow(/positive integer/);
    expect(() => parseArgs(['--dataset=foo.json', '--max-tokens=abc'])).toThrow(/positive integer/);
  });

  it('rejects unknown arguments', () => {
    expect(() => parseArgs(['--dataset=foo.json', '--nope'])).toThrow(/Unknown argument/);
  });

  it('ignores the pnpm forwarding delimiter', () => {
    const parsed = parseArgs(['--', '--dataset=foo.json']);

    expect(parsed.options?.datasetPath).toBe('foo.json');
  });
});

describe('helpText', () => {
  it('mentions all flags', () => {
    const text = helpText();

    expect(text).toContain('--dataset=');
    expect(text).toContain('--prompt=');
    expect(text).toContain('--out=');
    expect(text).toContain('--model=');
    expect(text).toContain('--max-tokens=');
    expect(text).toContain('--concurrency=');
  });
});
