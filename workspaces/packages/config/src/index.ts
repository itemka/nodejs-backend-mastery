import { z } from 'zod';

// TODO: review list of env variables and its values (will do later by my self)
export const baseSchema = z.object({
  PORT: z.coerce.number().int().min(0).max(65_535).default(3000).describe('Port for HTTP server'),
  NODE_ENV: z
    .enum(['development', 'test', 'production'])
    .default('development')
    .describe('Runtime environment'),
  // LOG_LEVEL: z
  //   .enum(['trace', 'debug', 'info', 'warn', 'error', 'fatal', 'silent'])
  //   .default('info')
  //   .describe('Application log level'),
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
    const flattened = parsed.error.flatten();
    const details = Object.entries(flattened.fieldErrors)
      .flatMap(([key, msgs]) => (msgs ?? []).map((m) => `${key}: ${m}`))
      .join('; ');

    throw new Error(details ? `Invalid environment: ${details}` : 'Invalid environment');
  }

  return Object.freeze(parsed.data) as z.infer<T>;
}
