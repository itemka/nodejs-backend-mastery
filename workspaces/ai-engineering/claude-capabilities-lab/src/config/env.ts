import { config as loadDotenv } from 'dotenv';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

export const DEFAULT_MODEL = 'claude-sonnet-4-6';

export interface LabConfig {
  readonly anthropicApiKey: string;
  readonly model: string;
}

const here = path.dirname(fileURLToPath(import.meta.url));
const labRoot = path.resolve(here, '..', '..');

export function loadEnvironment(envPath: string = path.join(labRoot, '.env')): void {
  loadDotenv({ path: envPath });
}

export function getLabRoot(): string {
  return labRoot;
}

export function loadConfig(): LabConfig {
  const apiKey = process.env.ANTHROPIC_API_KEY;

  if (!apiKey) {
    throw new Error('ANTHROPIC_API_KEY is not set. Add it to claude-capabilities-lab/.env.');
  }

  return {
    anthropicApiKey: apiKey,
    model: process.env.ANTHROPIC_MODEL ?? DEFAULT_MODEL,
  };
}
