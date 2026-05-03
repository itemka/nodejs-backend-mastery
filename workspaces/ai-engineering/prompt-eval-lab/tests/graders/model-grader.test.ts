import type { LlmProvider, LlmRequest } from '@workspaces/packages/llm-client';
import { describe, expect, it } from 'vitest';

import type { TestCase } from '../../src/datasets/types.js';
import { GRADER_JSON_SCHEMA, gradeByModel } from '../../src/graders/model-grader.js';

function makeProvider(text: string): { calls: LlmRequest[]; provider: LlmProvider } {
  const calls: LlmRequest[] = [];
  const provider: LlmProvider = {
    createMessage(request) {
      calls.push(request);

      return Promise.resolve({ raw: { text }, text });
    },
  };

  return { calls, provider };
}

const TEST_CASE: TestCase = {
  format: 'json',
  solution_criteria: 'Must be valid JSON.',
  task: 'Return a small JSON object.',
};

describe('gradeByModel', () => {
  it('passes the test case task, output, and criteria into the grader prompt', async () => {
    const { calls, provider } = makeProvider(
      JSON.stringify({
        reasoning: 'Looks good.',
        score: 8,
        strengths: ['Compact'],
        weaknesses: ['No comments'],
      }),
    );

    await gradeByModel({
      model: 'm',
      output: '{"a":1}',
      provider,
      testCase: TEST_CASE,
    });

    expect(calls).toHaveLength(1);
    const sent = calls[0]!;
    const userMessage = sent.messages[0]!.content;

    expect(userMessage).toContain('Return a small JSON object.');
    expect(userMessage).toContain('{"a":1}');
    expect(userMessage).toContain('Must be valid JSON.');
    expect(sent.outputFormat?.jsonSchema).toEqual(GRADER_JSON_SCHEMA);
    expect(sent.stream).toBe(false);
  });

  it('parses the JSON response into a typed grader result', async () => {
    const { provider } = makeProvider(
      JSON.stringify({
        reasoning: 'Concise object.',
        score: 9,
        strengths: ['Compact', 'Valid'],
        weaknesses: ['Minimal'],
      }),
    );

    const result = await gradeByModel({
      model: 'm',
      output: '{"a":1}',
      provider,
      testCase: TEST_CASE,
    });

    expect(result).toEqual({
      reasoning: 'Concise object.',
      score: 9,
      strengths: ['Compact', 'Valid'],
      weaknesses: ['Minimal'],
    });
  });

  it('throws a descriptive error when the response is not JSON', async () => {
    const { provider } = makeProvider('not json');

    await expect(
      gradeByModel({ model: 'm', output: '{}', provider, testCase: TEST_CASE }),
    ).rejects.toThrow(/non-JSON output/);
  });

  it('throws a descriptive error when the response shape is wrong', async () => {
    const { provider } = makeProvider(JSON.stringify({ score: 'high' }));

    await expect(
      gradeByModel({ model: 'm', output: '{}', provider, testCase: TEST_CASE }),
    ).rejects.toThrow(/failed validation/);
  });
});
