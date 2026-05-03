import path from 'node:path';

import { DEFAULT_CONCURRENCY, MAX_CONCURRENCY, MIN_CONCURRENCY } from '../eval/runner.js';
import { DEFAULT_TEMPLATE_NAME, isTemplateName, type TemplateName } from '../prompts/templates.js';

export interface CliOptions {
  readonly concurrency: number;
  readonly datasetPath: string;
  readonly maxTokens?: number;
  readonly model?: string;
  readonly outPath?: string;
  readonly templateName: TemplateName;
}

export interface ParsedArgs {
  readonly options?: CliOptions;
  readonly shouldPrintHelp: boolean;
}

export function helpText(): string {
  return [
    'Usage: pnpm dev -- --dataset=<path> [options]',
    '',
    'Run a prompt-evaluation pipeline against a JSON dataset.',
    '',
    'Required:',
    '  --dataset=<path>          Path to a JSON dataset file.',
    '',
    'Options:',
    `  --prompt=<name>           Prompt template name (default: ${DEFAULT_TEMPLATE_NAME}).`,
    '  --out=<path>              Report path (default: timestamped .html in reports/; use .json for raw JSON).',
    '  --model=<id>              Override the ANTHROPIC_MODEL env value.',
    '  --max-tokens=<n>          Max tokens per LLM call (positive integer).',
    `  --concurrency=<n>         Parallel test cases (default: ${DEFAULT_CONCURRENCY}, range ${MIN_CONCURRENCY}..${MAX_CONCURRENCY}).`,
    '  -h, --help                Show this help message.',
  ].join('\n');
}

export function parseArgs(argv: readonly string[]): ParsedArgs {
  let datasetPath: string | undefined;
  let templateName: TemplateName = DEFAULT_TEMPLATE_NAME;
  let outPath: string | undefined;
  let model: string | undefined;
  let maxTokens: number | undefined;
  let concurrency: number = DEFAULT_CONCURRENCY;

  for (const argument of argv) {
    if (argument === '--') {
      continue;
    }

    if (argument === '--help' || argument === '-h') {
      return { shouldPrintHelp: true };
    }

    if (argument.startsWith('--dataset=')) {
      datasetPath = argument.slice('--dataset='.length);
      continue;
    }

    if (argument.startsWith('--prompt=')) {
      const value = argument.slice('--prompt='.length);

      if (!isTemplateName(value)) {
        throw new Error(`Unknown prompt template: ${value}`);
      }

      templateName = value;
      continue;
    }

    if (argument.startsWith('--out=')) {
      const value = argument.slice('--out='.length);
      const ext = path.extname(value).toLowerCase();

      if (ext !== '.html' && ext !== '.json') {
        throw new Error('--out must have a .html or .json extension.');
      }

      outPath = value;
      continue;
    }

    if (argument.startsWith('--model=')) {
      const value = argument.slice('--model='.length);

      if (!value) {
        throw new Error('--model must be a non-empty string.');
      }

      model = value;
      continue;
    }

    if (argument.startsWith('--max-tokens=')) {
      const value = Number(argument.slice('--max-tokens='.length));

      if (!Number.isInteger(value) || value <= 0) {
        throw new Error('--max-tokens must be a positive integer.');
      }

      maxTokens = value;
      continue;
    }

    if (argument.startsWith('--concurrency=')) {
      const value = Number(argument.slice('--concurrency='.length));

      if (!Number.isInteger(value) || value < MIN_CONCURRENCY || value > MAX_CONCURRENCY) {
        throw new Error(
          `--concurrency must be an integer between ${MIN_CONCURRENCY} and ${MAX_CONCURRENCY}.`,
        );
      }

      concurrency = value;
      continue;
    }

    throw new Error(`Unknown argument: ${argument}`);
  }

  if (!datasetPath) {
    throw new Error('--dataset=<path> is required.');
  }

  return {
    options: {
      concurrency,
      datasetPath,
      templateName,
      ...(maxTokens === undefined ? {} : { maxTokens }),
      ...(model === undefined ? {} : { model }),
      ...(outPath === undefined ? {} : { outPath }),
    },
    shouldPrintHelp: false,
  };
}
