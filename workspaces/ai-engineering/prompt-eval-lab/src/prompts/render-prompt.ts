const PLACEHOLDER_PATTERN = /\{\{\s*(\w+)\s*\}\}/g;

export function renderPrompt(template: string, vars: Readonly<Record<string, string>>): string {
  return template.replaceAll(PLACEHOLDER_PATTERN, (_match, key: string) => {
    if (!Object.hasOwn(vars, key)) {
      throw new Error(`Missing template variable: ${key}`);
    }

    return vars[key] ?? '';
  });
}
