import type { ChatOptions } from '../chat/types.js';
import type { OutputFormatConfig } from '../llm/types.js';

export const OUTPUT_FORMAT_PRESETS = {
  csv: {
    instructions:
      'Return the response as CSV only. Include a header row. Do not include comments, markdown fences, or explanation.',
  },
  html: {
    instructions:
      'Return the response as HTML only. Use an unordered list when listing items. Do not include comments, markdown fences, or explanation.',
  },
  json: {
    instructions:
      'Return the response as JSON only. Use this shape when returning commands: {"commands":["..."]}. Do not include comments, markdown fences, or explanation.',
    jsonSchema: {
      additionalProperties: false,
      properties: {
        commands: {
          items: { type: 'string' },
          type: 'array',
        },
      },
      required: ['commands'],
      type: 'object',
    },
  },
} satisfies Record<string, OutputFormatConfig>;

type OutputFormatName = keyof typeof OUTPUT_FORMAT_PRESETS;

function parseOutputFormat(value: string): OutputFormatConfig {
  if (value in OUTPUT_FORMAT_PRESETS) {
    return OUTPUT_FORMAT_PRESETS[value as OutputFormatName];
  }

  throw new Error('--output-format must be one of: json, csv, html.');
}

export interface ParsedArgs {
  readonly options: ChatOptions;
  readonly shouldPrintHelp: boolean;
}

export function helpText(): string {
  return [
    'Usage: pnpm dev [--max-tokens=<number>] [--debug-response] [--output-format=json|csv|html]',
    '',
    'Run the LLM chat app.',
    '',
    'Options:',
    '  --max-tokens=<number>   Maximum number of output tokens per turn.',
    '  --debug-response        Print the full provider response object.',
    '  --output-format=<name>   Return a response formatted as json, csv, or html.',
    '  --structured-commands   Alias for --output-format=json.',
    '  -h, --help              Show this help message.',
  ].join('\n');
}

export function parseArgs(argv: readonly string[]): ParsedArgs {
  const options: ChatOptions = {};

  for (const argument of argv) {
    if (argument === '--') {
      continue;
    }

    if (argument === '--help' || argument === '-h') {
      return { options, shouldPrintHelp: true };
    }

    if (argument === '--debug-response') {
      options.debugResponse = true;
      continue;
    }

    if (argument === '--structured-commands') {
      options.outputFormat = OUTPUT_FORMAT_PRESETS.json;
      continue;
    }

    if (argument.startsWith('--output-format=')) {
      options.outputFormat = parseOutputFormat(argument.slice('--output-format='.length));
      continue;
    }

    if (argument.startsWith('--max-tokens=')) {
      const value = Number(argument.slice('--max-tokens='.length));

      if (!Number.isInteger(value) || value <= 0) {
        throw new Error('--max-tokens must be a positive integer.');
      }

      options.maxTokens = value;
      continue;
    }

    throw new Error(`Unknown argument: ${argument}`);
  }

  return { options, shouldPrintHelp: false };
}
