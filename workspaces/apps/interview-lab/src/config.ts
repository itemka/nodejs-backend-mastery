import { z } from 'zod';

const environmentSchema = z.object({
  NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),
  PORT: z.coerce.number().int().min(1).max(65_535).default(3100),
});

export type Environment = z.infer<typeof environmentSchema>;

export function validateEnvironment(config: Record<string, unknown>): Environment {
  const result = environmentSchema.safeParse(config);

  if (!result.success) {
    // Report field names only; future lab configuration may contain credentials.
    const fields = result.error.issues.map((issue) => issue.path.join('.')).join(', ');

    throw new Error(`Invalid environment fields: ${fields}`);
  }

  return result.data;
}
