import { summarize } from '../../src/eval/summary.js';
import type { EvalResult } from '../../src/eval/types.js';
import { PASS_SCORE } from '../../src/reports/write-report.js';
import type { ReportPayload } from '../../src/reports/write-report.js';

export function buildPayload(results: EvalResult[] = []): ReportPayload {
  return {
    metadata: {
      concurrency: 3,
      datasetPath: '/tmp/dataset.json',
      finishedAt: '2026-05-01T00:00:01Z',
      model: 'claude-sonnet-4-6',
      startedAt: '2026-05-01T00:00:00Z',
      templateName: 'code-assistant.v1',
    },
    passScore: PASS_SCORE,
    results,
    summary: summarize(results),
  };
}

export function makeResult(overrides: Partial<EvalResult> = {}): EvalResult {
  return {
    modelGrade: {
      reasoning: 'Meets the expected shape.',
      score: 8,
      strengths: ['Valid'],
      weaknesses: ['Brief'],
    },
    output: '{"ok":true}',
    score: 9,
    syntaxScore: 10,
    testCase: {
      format: 'json',
      prompt_inputs: {
        content: 'Return a JSON object.',
      },
      scenario: 'JSON extraction scenario',
      solution_criteria: 'Returns valid JSON; Includes the ok field',
      task: 'Return {"ok": true}.',
    },
    ...overrides,
  };
}
