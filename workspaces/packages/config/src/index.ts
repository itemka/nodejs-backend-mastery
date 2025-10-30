import { z } from 'zod';

export const baseSchema = z.object({
  NODE_ENV: z.enum(['development', 'qa', 'production', 'test']).default('development'),
  PORT: z.coerce.number().int().min(0).max(65_535).default(3000).describe('Port for HTTP server'),
});

export type BaseEnv = z.infer<typeof baseSchema>;

/**
 * Load + validate env for any app.
 * - schema: app-specific schema (usually baseSchema.extend({...}))
 * - cwd: where to read .env.* files from (defaults to the current app dir)
 * - loadDotenv: disable in serverless (Lambda) because platform injects env
 */
export function defineEnv<T extends z.ZodTypeAny>(schema: T): z.infer<T> {
  const parsed = schema.safeParse(process.env);

  if (!parsed.success) {
    const flattened = parsed.error.flatten((issue) => issue.message);
    const details = Object.entries(flattened.fieldErrors ?? {})
      .flatMap(([key, messages]) => {
        const msgs: string[] = Array.isArray(messages)
          ? messages.filter((msg): msg is string => typeof msg === 'string')
          : [];

        return msgs.map((msg) => `${key}: ${msg}`);
      })
      .join('; ');

    throw new Error(details ? `Invalid environment: ${details}` : 'Invalid environment');
  }

  return Object.freeze(parsed.data) as z.infer<T>;
}
