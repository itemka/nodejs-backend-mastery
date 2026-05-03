import { z } from 'zod';

export const modelGraderResultSchema = z.object({
  reasoning: z.string(),
  score: z.number().min(1).max(10),
  strengths: z.array(z.string()),
  weaknesses: z.array(z.string()),
});

export type ModelGraderResult = z.infer<typeof modelGraderResultSchema>;
