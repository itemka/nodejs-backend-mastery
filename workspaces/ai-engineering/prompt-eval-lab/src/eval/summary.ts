import type { TestCaseFormat } from '../datasets/types.js';
import type { EvalResult, EvalSummary, FormatBucket, FormatBuckets } from './types.js';

const FORMATS: readonly TestCaseFormat[] = ['json', 'regex', 'typescript'];

export function summarize(results: readonly EvalResult[]): EvalSummary {
  const total = results.length;

  if (total === 0) {
    return {
      averageScore: 0,
      byFormat: emptyBuckets(),
      total: 0,
    };
  }

  const sums: Record<TestCaseFormat, { count: number; total: number }> = {
    json: { count: 0, total: 0 },
    regex: { count: 0, total: 0 },
    typescript: { count: 0, total: 0 },
  };

  let scoreSum = 0;

  for (const result of results) {
    scoreSum += result.score;
    const bucket = sums[result.testCase.format];
    bucket.count += 1;
    bucket.total += result.score;
  }

  const byFormat: Record<TestCaseFormat, FormatBucket> = {
    json: bucketFromSum(sums.json),
    regex: bucketFromSum(sums.regex),
    typescript: bucketFromSum(sums.typescript),
  };

  return {
    averageScore: scoreSum / total,
    byFormat,
    total,
  };
}

export function formatSummaryLines(summary: EvalSummary): string[] {
  const lines = [
    `Total: ${summary.total}`,
    `Average score: ${summary.averageScore.toFixed(2)}`,
    'Per format:',
  ];

  for (const format of FORMATS) {
    const bucket = summary.byFormat[format];

    if (bucket.count === 0) {
      continue;
    }

    lines.push(`  ${format}: ${bucket.count} case(s), avg ${bucket.average.toFixed(2)}`);
  }

  return lines;
}

function bucketFromSum(sum: { count: number; total: number }): FormatBucket {
  return {
    average: sum.count === 0 ? 0 : sum.total / sum.count,
    count: sum.count,
  };
}

function emptyBuckets(): FormatBuckets {
  return {
    json: { average: 0, count: 0 },
    regex: { average: 0, count: 0 },
    typescript: { average: 0, count: 0 },
  };
}
