import type { LlmUsage } from '@workspaces/packages/llm-client';
import { z } from 'zod';

export const modelGraderResultSchema = z.object({
  reasoning: z.string(),
  score: z.number().min(1).max(10),
  strengths: z.array(z.string()),
  weaknesses: z.array(z.string()),
});

export type ModelGraderResult = z.infer<typeof modelGraderResultSchema>;

export interface ModelGraderEvaluation {
  readonly grade: ModelGraderResult;
  readonly usage?: LlmUsage;
}
