import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';

const TEMPLATE_PATHS = {
  'code-assistant.v1': fileURLToPath(
    new URL('../../prompts/code-assistant.v1.prompt.txt', import.meta.url),
  ),
} as const;

export type TemplateName = keyof typeof TEMPLATE_PATHS;

export const DEFAULT_TEMPLATE_NAME: TemplateName = 'code-assistant.v1';

export const TEMPLATE_NAMES: readonly TemplateName[] = Object.keys(
  TEMPLATE_PATHS,
) as TemplateName[];

export function isTemplateName(value: string): value is TemplateName {
  return Object.hasOwn(TEMPLATE_PATHS, value);
}

export async function loadTemplate(name: TemplateName): Promise<string> {
  return readFile(TEMPLATE_PATHS[name], 'utf8');
}
