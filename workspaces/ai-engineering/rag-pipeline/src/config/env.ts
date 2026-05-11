import { z } from 'zod';

export const DEFAULT_VOYAGE_EMBEDDING_MODEL = 'voyage-3-large';

const envSchema = z.object({
  HOST: z.string().trim().min(1).default('127.0.0.1'),
  NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),
  PORT: z.coerce.number().int().min(1).max(65_535).default(4100),
  REQUEST_TIMEOUT_MS: z.coerce.number().int().min(1000).max(300_000).default(120_000),
  VOYAGE_API_KEY: z.string().trim().min(1, 'VOYAGE_API_KEY is required.'),
  VOYAGE_EMBEDDING_MODEL: z.string().trim().min(1).default(DEFAULT_VOYAGE_EMBEDDING_MODEL),
});

export type AppEnv = z.infer<typeof envSchema>;

export function loadEnv(input: NodeJS.ProcessEnv = process.env): AppEnv {
  return envSchema.parse(input);
}
