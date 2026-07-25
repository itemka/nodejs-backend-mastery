import type { LlmProvider, LlmUsage } from '@workspaces/packages/llm-client';

import type { TestCase, TestCaseFormat } from '../datasets/types.js';
import type { SyntaxScore } from '../graders/code-validators.js';
import type { ModelGraderResult } from '../graders/types.js';

export interface EvalCallUsage {
  readonly generation?: LlmUsage;
  readonly grading?: LlmUsage;
}

export interface EvalResult {
  readonly modelGrade: ModelGraderResult;
  readonly output: string;
  readonly score: number;
  readonly syntaxScore: SyntaxScore;
  readonly testCase: TestCase;
  readonly usage?: EvalCallUsage;
}

export interface FormatBucket {
  readonly average: number;
  readonly count: number;
}

export type FormatBuckets = Readonly<Record<TestCaseFormat, FormatBucket>>;

export interface TokenUsageTotals {
  readonly inputTokens: number;
  readonly outputTokens: number;
}

export interface EvalTokenUsageSummary {
  readonly generation?: TokenUsageTotals;
  readonly grading?: TokenUsageTotals;
  readonly total?: TokenUsageTotals;
}

export interface EvalSummary {
  readonly averageScore: number;
  readonly byFormat: FormatBuckets;
  readonly tokenUsage?: EvalTokenUsageSummary;
  readonly total: number;
}

export interface PassingCaseTokenMetrics {
  readonly passingCases: number;
  readonly tokensPerPassingCase?: number;
}

export interface RunnerDeps {
  readonly concurrency?: number;
  readonly graderMaxTokens?: number;
  readonly maxTokens?: number;
  readonly model: string;
  readonly promptTemplate: string;
  readonly provider: LlmProvider;
}
