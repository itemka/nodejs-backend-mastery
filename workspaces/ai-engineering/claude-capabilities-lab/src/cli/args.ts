export type ScenarioName =
  | 'thinking'
  | 'image'
  | 'pdf'
  | 'citations'
  | 'cache'
  | 'files'
  | 'code-exec';

export const SCENARIO_NAMES: readonly ScenarioName[] = [
  'thinking',
  'image',
  'pdf',
  'citations',
  'cache',
  'files',
  'code-exec',
];

export interface ParsedFlags {
  readonly flags: Map<string, string | true>;
  readonly multi: Map<string, string[]>;
  readonly positionals: readonly string[];
}

export function parseFlags(args: readonly string[]): ParsedFlags {
  const flags = new Map<string, string | true>();
  const multi = new Map<string, string[]>();
  const positionals: string[] = [];

  for (const argument of args) {
    if (argument === '--') {
      continue;
    }

    if (!argument.startsWith('--')) {
      positionals.push(argument);
      continue;
    }

    const eq = argument.indexOf('=');
    const name = eq === -1 ? argument.slice(2) : argument.slice(2, eq);
    const value: string | true = eq === -1 ? true : argument.slice(eq + 1);

    if (name === 'image') {
      const arr = multi.get(name) ?? [];

      if (typeof value === 'string') {
        arr.push(value);
      }

      multi.set(name, arr);
      continue;
    }

    flags.set(name, value);
  }

  return { flags, multi, positionals };
}

export function getString(parsed: ParsedFlags, name: string): string | undefined {
  const value = parsed.flags.get(name);

  return typeof value === 'string' ? value : undefined;
}

export function getBoolean(parsed: ParsedFlags, name: string): boolean {
  return parsed.flags.has(name);
}

export function getInt(parsed: ParsedFlags, name: string): number | undefined {
  const value = getString(parsed, name);

  if (value === undefined) {
    return undefined;
  }

  const parsedValue = Number(value);

  if (!Number.isInteger(parsedValue) || parsedValue <= 0) {
    throw new Error(`--${name} must be a positive integer.`);
  }

  return parsedValue;
}
