import type { TestCaseFormat } from '../datasets/types.js';
import type {
  EvalCallUsage,
  EvalResult,
  EvalSummary,
  EvalTokenUsageSummary,
  FormatBucket,
  FormatBuckets,
  PassingCaseTokenMetrics,
  TokenUsageTotals,
} from './types.js';

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
  const tokenUsage = summarizeTokenUsage(results);

  return {
    averageScore: scoreSum / total,
    byFormat,
    ...(tokenUsage === undefined ? {} : { tokenUsage }),
    total,
  };
}

export function measurePassingCaseTokens(
  results: readonly EvalResult[],
  summary: EvalSummary,
  passScore: number,
): PassingCaseTokenMetrics {
  const passingCases = results.filter((result) => result.score >= passScore).length;
  const total = summary.tokenUsage?.total;

  return {
    passingCases,
    ...(passingCases === 0 || total === undefined
      ? {}
      : {
          tokensPerPassingCase: (total.inputTokens + total.outputTokens) / passingCases,
        }),
  };
}

export function formatSummaryLines(
  summary: EvalSummary,
  tokenMetrics?: PassingCaseTokenMetrics,
): string[] {
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

  lines.push(
    'Token usage:',
    `  generation: ${formatTokenTotals(summary.tokenUsage?.generation)}`,
    `  grading: ${formatTokenTotals(summary.tokenUsage?.grading)}`,
    `  total: ${formatTokenTotals(summary.tokenUsage?.total)}`,
    `Tokens per passing case: ${formatTokensPerPassingCase(summary, tokenMetrics)}`,
  );

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

function formatTokensPerPassingCase(
  summary: EvalSummary,
  tokenMetrics: PassingCaseTokenMetrics | undefined,
): string {
  if (summary.tokenUsage?.total === undefined) {
    return 'not reported';
  }

  if (tokenMetrics?.passingCases === 0) {
    return 'not applicable';
  }

  return tokenMetrics?.tokensPerPassingCase?.toFixed(2) ?? 'not reported';
}

function formatTokenTotals(totals: TokenUsageTotals | undefined): string {
  return totals === undefined
    ? 'not reported'
    : `${totals.inputTokens} input, ${totals.outputTokens} output`;
}

function summarizeTokenUsage(results: readonly EvalResult[]): EvalTokenUsageSummary | undefined {
  const generation = sumCallUsage(results, 'generation');
  const grading = sumCallUsage(results, 'grading');

  if (generation === undefined && grading === undefined) {
    return undefined;
  }

  return {
    ...(generation === undefined ? {} : { generation }),
    ...(grading === undefined ? {} : { grading }),
    ...(generation === undefined || grading === undefined
      ? {}
      : {
          total: {
            inputTokens: generation.inputTokens + grading.inputTokens,
            outputTokens: generation.outputTokens + grading.outputTokens,
          },
        }),
  };
}

function sumCallUsage(
  results: readonly EvalResult[],
  phase: keyof EvalCallUsage,
): TokenUsageTotals | undefined {
  if (results.length === 0) {
    return undefined;
  }

  let inputTokens = 0;
  let outputTokens = 0;

  for (const result of results) {
    const usage = result.usage?.[phase];

    if (usage === undefined) {
      return undefined;
    }

    inputTokens += usage.inputTokens;
    outputTokens += usage.outputTokens;
  }

  return { inputTokens, outputTokens };
}
