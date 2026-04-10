import type { z } from 'zod';

export function validateWithSchema<TSchema extends z.ZodTypeAny>(
  schema: TSchema,
  input: unknown,
): z.infer<TSchema> {
  return schema.parse(input);
}
