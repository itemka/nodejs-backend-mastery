import { describe, expect, it } from 'vitest';

import {
  gradeSyntax,
  validateJson,
  validateRegex,
  validateTypescript,
} from '../../src/graders/code-validators.js';

describe('validateJson', () => {
  it('accepts a valid JSON object', () => {
    expect(validateJson('{"a":1}')).toBe(10);
  });

  it('accepts a valid JSON array', () => {
    expect(validateJson('[1,2,3]')).toBe(10);
  });

  it('rejects malformed JSON', () => {
    expect(validateJson('{a:1}')).toBe(0);
  });

  it('trims surrounding whitespace before parsing', () => {
    expect(validateJson('  {"a":1}  \n')).toBe(10);
  });
});

describe('validateRegex', () => {
  it('accepts a simple regex', () => {
    expect(validateRegex('^[a-z]+$')).toBe(10);
  });

  it('rejects an unclosed character class', () => {
    expect(validateRegex('[unclosed')).toBe(0);
  });

  it('rejects blank output', () => {
    expect(validateRegex('')).toBe(0);
    expect(validateRegex('  \n')).toBe(0);
  });
});

describe('validateTypescript', () => {
  it('accepts valid TypeScript', () => {
    expect(validateTypescript('const x: number = 1;')).toBe(10);
  });

  it('accepts a valid arrow function', () => {
    expect(validateTypescript('export const add = (a: number, b: number): number => a + b;')).toBe(
      10,
    );
  });

  it('rejects a syntax error', () => {
    expect(validateTypescript('const x: number = ;')).toBe(0);
  });

  it('rejects blank output', () => {
    expect(validateTypescript('')).toBe(0);
    expect(validateTypescript('  \n')).toBe(0);
  });
});

describe('gradeSyntax', () => {
  it('dispatches to the JSON validator for the json format', () => {
    expect(gradeSyntax('{}', 'json')).toBe(10);
    expect(gradeSyntax('not json', 'json')).toBe(0);
  });

  it('dispatches to the regex validator for the regex format', () => {
    expect(gradeSyntax('^x$', 'regex')).toBe(10);
    expect(gradeSyntax('[unclosed', 'regex')).toBe(0);
  });

  it('dispatches to the TypeScript validator for the typescript format', () => {
    expect(gradeSyntax('const a = 1;', 'typescript')).toBe(10);
    expect(gradeSyntax('const a = ;', 'typescript')).toBe(0);
  });
});
