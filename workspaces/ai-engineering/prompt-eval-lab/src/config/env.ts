import { loadEnvironment as loadEnvironmentFromPath } from '@workspaces/packages/llm-client';
import { fileURLToPath } from 'node:url';

export type { AppConfig } from '@workspaces/packages/llm-client';
export { DEFAULT_MODEL, loadConfig } from '@workspaces/packages/llm-client';

export function loadEnvironment(envPath?: string): void {
  loadEnvironmentFromPath(envPath ?? fileURLToPath(new URL('../../.env', import.meta.url)));
}
