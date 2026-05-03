import { z } from 'zod';

export const testCaseFormatSchema = z.enum(['json', 'typescript', 'regex']);

export type TestCaseFormat = z.infer<typeof testCaseFormatSchema>;

export const testCaseSchema = z.object({
  format: testCaseFormatSchema,
  solution_criteria: z.string().min(1),
  task: z.string().min(1),
});

export type TestCase = z.infer<typeof testCaseSchema>;

export const datasetSchema = z.array(testCaseSchema);

export type Dataset = z.infer<typeof datasetSchema>;
