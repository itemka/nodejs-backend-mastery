import type { Dataset, TestCase } from '../datasets/types.js';
import { gradeSyntax } from '../graders/code-validators.js';
import { gradeByModel } from '../graders/model-grader.js';
import { renderPrompt } from '../prompts/render-prompt.js';
import { runWithConcurrency } from './concurrency.js';
import type { EvalResult, RunnerDeps } from './types.js';

export const DEFAULT_CONCURRENCY = 3;
export const MIN_CONCURRENCY = 1;
export const MAX_CONCURRENCY = 10;
export const DEFAULT_MAX_TOKENS = 1024;

export function clampConcurrency(value: number): number {
  if (!Number.isFinite(value)) {
    return DEFAULT_CONCURRENCY;
  }

  return Math.max(MIN_CONCURRENCY, Math.min(MAX_CONCURRENCY, Math.floor(value)));
}

export async function runTestCase(testCase: TestCase, deps: RunnerDeps): Promise<EvalResult> {
  const prompt = renderPrompt(deps.promptTemplate, { task: testCase.task });

  const response = await deps.provider.createMessage({
    maxTokens: deps.maxTokens ?? DEFAULT_MAX_TOKENS,
    messages: [{ content: prompt, role: 'user' }],
    model: deps.model,
    stream: false,
  });

  const output = response.text;

  const modelGrade = await gradeByModel({
    model: deps.model,
    output,
    provider: deps.provider,
    testCase,
    ...(deps.graderMaxTokens === undefined ? {} : { maxTokens: deps.graderMaxTokens }),
  });

  const syntaxScore = gradeSyntax(output, testCase.format);
  const score = (modelGrade.score + syntaxScore) / 2;

  return { modelGrade, output, score, syntaxScore, testCase };
}

export async function runEval(dataset: Dataset, deps: RunnerDeps): Promise<EvalResult[]> {
  const concurrency = clampConcurrency(deps.concurrency ?? DEFAULT_CONCURRENCY);

  return runWithConcurrency(dataset, concurrency, (testCase) => runTestCase(testCase, deps));
}
