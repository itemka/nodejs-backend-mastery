import { config as loadDotenv } from 'dotenv';
import { fileURLToPath } from 'node:url';

export const DEFAULT_MODEL = 'claude-sonnet-4-6';

export interface AppConfig {
  readonly anthropicApiKey: string;
  readonly model: string;
}

export function loadEnvironment(envPath?: string): void {
  loadDotenv({
    path: envPath ?? fileURLToPath(new URL('../../.env', import.meta.url)),
  });
}

export function loadConfig(): AppConfig {
  const apiKey = process.env.ANTHROPIC_API_KEY;

  if (!apiKey) {
    throw new Error('ANTHROPIC_API_KEY is not set. Add it to .env.');
  }

  return {
    anthropicApiKey: apiKey,
    model: process.env.ANTHROPIC_MODEL ?? DEFAULT_MODEL,
  };
}
