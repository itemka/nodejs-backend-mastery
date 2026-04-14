import { z } from 'zod';

import type { SupportedModelId } from '../../../shared/models.js';
import { defaultModelId, isSupportedModelId } from '../../../shared/models.js';

const envSchema = z.object({
  DEFAULT_MODEL: z
    .string()
    .trim()
    .default(defaultModelId)
    .refine((value) => isSupportedModelId(value), {
      message: 'DEFAULT_MODEL must be one of the configured supported models.',
    }),
  HOST: z.string().trim().min(1).default('127.0.0.1'),
  HTTPS_CERT_PATH: z.string().trim().min(1).default('.certs/localhost.pem'),
  HTTPS_KEY_PATH: z.string().trim().min(1).default('.certs/localhost-key.pem'),
  NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),
  OLLAMA_API_KEY: z.string().trim().min(1).default('ollama'),
  OLLAMA_BASE_URL: z.string().url().default('http://localhost:11434/v1'),
  OLLAMA_RAW_BASE_URL: z.string().url().default('http://localhost:11434'),
  PORT: z.coerce.number().int().min(1).max(65_535).default(4000),
  REQUEST_TIMEOUT_MS: z.coerce.number().int().min(1000).max(300_000).default(120_000),
});

export type AppEnv = Omit<z.infer<typeof envSchema>, 'DEFAULT_MODEL'> & {
  DEFAULT_MODEL: SupportedModelId;
};

export function loadEnv(input: NodeJS.ProcessEnv = process.env): AppEnv {
  const parsed = envSchema.parse(input);

  if (!isSupportedModelId(parsed.DEFAULT_MODEL)) {
    throw new Error(`DEFAULT_MODEL "${parsed.DEFAULT_MODEL}" is not a supported model.`);
  }

  return parsed as AppEnv;
}
