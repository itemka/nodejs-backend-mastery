import type { LlmProvider } from '@workspaces/packages/llm-client';

import type { TestCase } from '../datasets/types.js';
import { renderPrompt } from '../prompts/render-prompt.js';
import { type ModelGraderResult, modelGraderResultSchema } from './types.js';

const GRADER_PROMPT = `You are an expert code reviewer. Evaluate the following AI-generated solution.

Original Task:
<task>
{{task}}
</task>

Solution to Evaluate:
<solution>
{{output}}
</solution>

Criteria you should use to evaluate the solution:
<criteria>
{{solution_criteria}}
</criteria>

Provide your evaluation as a JSON object with the following fields:
- "strengths": An array of 1-3 key strengths
- "weaknesses": An array of 1-3 key areas for improvement
- "reasoning": A concise explanation of your overall assessment
- "score": A number between 1 and 10

Respond with JSON only. Keep your response concise and direct.`;

export const GRADER_JSON_SCHEMA: Record<string, unknown> = {
  additionalProperties: false,
  properties: {
    reasoning: { type: 'string' },
    score: { type: 'number' },
    strengths: { items: { type: 'string' }, type: 'array' },
    weaknesses: { items: { type: 'string' }, type: 'array' },
  },
  required: ['strengths', 'weaknesses', 'reasoning', 'score'],
  type: 'object',
};

export const DEFAULT_GRADER_MAX_TOKENS = 1024;

export interface GradeByModelArgs {
  readonly maxTokens?: number;
  readonly model: string;
  readonly output: string;
  readonly provider: LlmProvider;
  readonly testCase: TestCase;
}

export async function gradeByModel(args: GradeByModelArgs): Promise<ModelGraderResult> {
  const prompt = renderPrompt(GRADER_PROMPT, {
    output: args.output,
    solution_criteria: args.testCase.solution_criteria,
    task: args.testCase.task,
  });

  const response = await args.provider.createMessage({
    maxTokens: args.maxTokens ?? DEFAULT_GRADER_MAX_TOKENS,
    messages: [{ content: prompt, role: 'user' }],
    model: args.model,
    outputFormat: {
      instructions:
        'Return the response as JSON only matching the requested schema. Do not include comments, markdown fences, or explanation.',
      jsonSchema: GRADER_JSON_SCHEMA,
    },
    stream: false,
  });

  let parsed: unknown;

  try {
    parsed = JSON.parse(response.text);
  } catch (error) {
    throw new Error(
      `Model grader returned non-JSON output: ${error instanceof Error ? error.message : String(error)}`,
    );
  }

  const result = modelGraderResultSchema.safeParse(parsed);

  if (!result.success) {
    const issues = result.error.issues
      .map((issue) => `${issue.path.join('.') || '<root>'}: ${issue.message}`)
      .join('; ');

    throw new Error(`Model grader output failed validation: ${issues}`);
  }

  return result.data;
}
