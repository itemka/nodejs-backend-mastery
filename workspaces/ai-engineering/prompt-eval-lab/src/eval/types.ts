import type { LlmProvider } from '@workspaces/packages/llm-client';

import type { TestCase, TestCaseFormat } from '../datasets/types.js';
import type { SyntaxScore } from '../graders/code-validators.js';
import type { ModelGraderResult } from '../graders/types.js';

export interface EvalResult {
  readonly modelGrade: ModelGraderResult;
  readonly output: string;
  readonly score: number;
  readonly syntaxScore: SyntaxScore;
  readonly testCase: TestCase;
}

export interface FormatBucket {
  readonly average: number;
  readonly count: number;
}

export type FormatBuckets = Readonly<Record<TestCaseFormat, FormatBucket>>;

export interface EvalSummary {
  readonly averageScore: number;
  readonly byFormat: FormatBuckets;
  readonly total: number;
}

export interface RunnerDeps {
  readonly concurrency?: number;
  readonly graderMaxTokens?: number;
  readonly maxTokens?: number;
  readonly model: string;
  readonly promptTemplate: string;
  readonly provider: LlmProvider;
}
