import { describe, expect, it } from 'vitest';

import type { TestCase } from '../../src/datasets/types.js';
import { formatSummaryLines, summarize } from '../../src/eval/summary.js';
import type { EvalResult } from '../../src/eval/types.js';

function makeResult(format: TestCase['format'], score: number): EvalResult {
  return {
    modelGrade: { reasoning: '', score: score, strengths: [], weaknesses: [] },
    output: '',
    score,
    syntaxScore: 10,
    testCase: { format, solution_criteria: 'criteria', task: 'task' },
  };
}

describe('summarize', () => {
  it('returns zero average and empty buckets for an empty input', () => {
    const summary = summarize([]);

    expect(summary).toEqual({
      averageScore: 0,
      byFormat: {
        json: { average: 0, count: 0 },
        regex: { average: 0, count: 0 },
        typescript: { average: 0, count: 0 },
      },
      total: 0,
    });
  });

  it('computes overall average and per-format buckets', () => {
    const summary = summarize([
      makeResult('json', 8),
      makeResult('json', 6),
      makeResult('regex', 10),
      makeResult('typescript', 5),
    ]);

    expect(summary.total).toBe(4);
    expect(summary.averageScore).toBeCloseTo((8 + 6 + 10 + 5) / 4, 5);
    expect(summary.byFormat.json).toEqual({ average: 7, count: 2 });
    expect(summary.byFormat.regex).toEqual({ average: 10, count: 1 });
    expect(summary.byFormat.typescript).toEqual({ average: 5, count: 1 });
  });
});

describe('formatSummaryLines', () => {
  it('renders header and per-format lines, skipping empty buckets', () => {
    const summary = summarize([makeResult('json', 9), makeResult('regex', 7)]);
    const lines = formatSummaryLines(summary);

    expect(lines[0]).toBe('Total: 2');
    expect(lines[1]).toBe('Average score: 8.00');
    expect(lines).toContain('  json: 1 case(s), avg 9.00');
    expect(lines).toContain('  regex: 1 case(s), avg 7.00');
    expect(lines.some((line) => line.startsWith('  typescript'))).toBe(false);
  });
});
