import type { LlmProvider, LlmRequest } from '@workspaces/packages/llm-client';
import { describe, expect, it } from 'vitest';

import type { Dataset, TestCase } from '../../src/datasets/types.js';
import { clampConcurrency, runEval, runTestCase } from '../../src/eval/runner.js';

const PROMPT_TEMPLATE = 'Solve: {{task}}';

function makeProvider(handlers: ((request: LlmRequest, callIndex: number) => string)[]): {
  calls: LlmRequest[];
  provider: LlmProvider;
} {
  const calls: LlmRequest[] = [];
  let next = 0;
  const provider: LlmProvider = {
    createMessage(request) {
      const i = next++;
      calls.push(request);
      const handler = handlers[i] ?? handlers.at(-1)!;
      const text = handler(request, i);

      return Promise.resolve({ raw: { text }, text });
    },
  };

  return { calls, provider };
}

const VALID_GRADE = JSON.stringify({
  reasoning: 'OK',
  score: 8,
  strengths: ['s'],
  weaknesses: ['w'],
});

describe('clampConcurrency', () => {
  it('clamps below the minimum to 1', () => {
    expect(clampConcurrency(0)).toBe(1);
    expect(clampConcurrency(-3)).toBe(1);
  });

  it('clamps above the maximum to 10', () => {
    expect(clampConcurrency(50)).toBe(10);
  });

  it('floors fractional values', () => {
    expect(clampConcurrency(3.7)).toBe(3);
  });

  it('falls back to default for non-finite input', () => {
    expect(clampConcurrency(Number.NaN)).toBe(3);
  });
});

describe('runTestCase', () => {
  const testCase: TestCase = {
    format: 'json',
    solution_criteria: 'JSON only',
    task: 'Return a tiny JSON object.',
  };

  it('renders the prompt, grades by model and syntax, and averages the score', async () => {
    const { calls, provider } = makeProvider([() => '{"ok":true}', () => VALID_GRADE]);

    const result = await runTestCase(testCase, {
      model: 'm',
      promptTemplate: PROMPT_TEMPLATE,
      provider,
    });

    expect(calls[0]?.messages[0]?.content).toBe('Solve: Return a tiny JSON object.');
    expect(result.output).toBe('{"ok":true}');
    expect(result.modelGrade.score).toBe(8);
    expect(result.syntaxScore).toBe(10);
    expect(result.score).toBe(9);
    expect(result.testCase).toBe(testCase);
  });

  it('records syntax score 0 for invalid output', async () => {
    const { provider } = makeProvider([() => 'not-json', () => VALID_GRADE]);

    const result = await runTestCase(testCase, {
      model: 'm',
      promptTemplate: PROMPT_TEMPLATE,
      provider,
    });

    expect(result.syntaxScore).toBe(0);
    expect(result.score).toBe(4);
  });
});

describe('runEval', () => {
  it('runs each case and preserves dataset order', async () => {
    const dataset: Dataset = [
      { format: 'json', solution_criteria: 'JSON', task: 'A' },
      { format: 'regex', solution_criteria: 'Regex', task: 'B' },
    ];

    let call = 0;
    const provider: LlmProvider = {
      createMessage() {
        const i = call++;
        // Pattern: even indexes are solution outputs, odd indexes are grader outputs.
        const text = i % 2 === 0 ? (i === 0 ? '{}' : '^a$') : VALID_GRADE;

        return Promise.resolve({ raw: { text }, text });
      },
    };

    const results = await runEval(dataset, {
      concurrency: 1,
      model: 'm',
      promptTemplate: PROMPT_TEMPLATE,
      provider,
    });

    expect(results).toHaveLength(2);
    expect(results[0]?.testCase.task).toBe('A');
    expect(results[1]?.testCase.task).toBe('B');
    expect(results[0]?.score).toBe(9);
    expect(results[1]?.score).toBe(9);
  });
});
