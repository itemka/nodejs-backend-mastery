import type { OutputFormatConfig } from '@workspaces/packages/llm-client';

import type { ChatOptions } from '../chat/types.js';

export interface EditFilesConfig {
  readonly textEditorMaxCharacters?: number;
  readonly workspaceRoot?: string;
}

export interface ParsedOptions extends ChatOptions {
  editFiles?: EditFilesConfig;
}

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
  readonly options: ParsedOptions;
  readonly shouldPrintHelp: boolean;
}

export function helpText(): string {
  return [
    'Usage: pnpm dev [--max-tokens=<number>] [--debug-response] [--output-format=json|csv|html] [--tools] [--fine-grained-tool-streaming] [--edit-files] [--workspace-root=<path>] [--text-editor-max-characters=<number>]',
    '',
    'Run the LLM chat app.',
    '',
    'Options:',
    '  --max-tokens=<number>                 Maximum number of output tokens per turn.',
    '  --debug-response                      Print the full provider response object.',
    '  --output-format=<name>                Return a response formatted as json, csv, or html.',
    '  --structured-commands                 Alias for --output-format=json.',
    '  --tools                               Enable local app tools for Claude tool-use turns.',
    '  --fine-grained-tool-streaming         Stream tool input JSON incrementally (requires --tools).',
    '  --edit-files                          Enable Anthropic Text Editor Tool (requires --tools).',
    '  --workspace-root=<path>               Allowed filesystem root for --edit-files (default: current working directory).',
    '  --text-editor-max-characters=<number> Optional max characters for view operations.',
    '  -h, --help                            Show this help message.',
  ].join('\n');
}

function parsePositiveInteger(raw: string, flag: string): number {
  const value = Number(raw);

  if (!Number.isInteger(value) || value <= 0) {
    throw new Error(`${flag} must be a positive integer.`);
  }

  return value;
}

export function parseArgs(argv: readonly string[]): ParsedArgs {
  const options: ParsedOptions = {};
  let editFilesEnabled = false;
  let workspaceRoot: string | undefined;
  let textEditorMaxCharacters: number | undefined;

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

    if (argument === '--tools') {
      options.toolsEnabled = true;
      continue;
    }

    if (argument === '--fine-grained-tool-streaming') {
      options.fineGrainedToolStreaming = true;
      continue;
    }

    if (argument === '--edit-files') {
      editFilesEnabled = true;
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
      options.maxTokens = parsePositiveInteger(
        argument.slice('--max-tokens='.length),
        '--max-tokens',
      );
      continue;
    }

    if (argument.startsWith('--workspace-root=')) {
      const value = argument.slice('--workspace-root='.length);

      if (value === '') {
        throw new Error('--workspace-root must be a non-empty path.');
      }

      workspaceRoot = value;
      continue;
    }

    if (argument.startsWith('--text-editor-max-characters=')) {
      textEditorMaxCharacters = parsePositiveInteger(
        argument.slice('--text-editor-max-characters='.length),
        '--text-editor-max-characters',
      );
      continue;
    }

    throw new Error(`Unknown argument: ${argument}`);
  }

  if (options.toolsEnabled === true && options.outputFormat !== undefined) {
    throw new Error('--tools cannot be combined with --output-format or --structured-commands.');
  }

  if (options.fineGrainedToolStreaming === true && options.toolsEnabled !== true) {
    throw new Error('--fine-grained-tool-streaming requires --tools.');
  }

  if (editFilesEnabled && options.toolsEnabled !== true) {
    throw new Error('--edit-files requires --tools.');
  }

  if (editFilesEnabled && options.fineGrainedToolStreaming === true) {
    throw new Error('--edit-files cannot be combined with --fine-grained-tool-streaming in v1.');
  }

  if (!editFilesEnabled && workspaceRoot !== undefined) {
    throw new Error('--workspace-root requires --edit-files.');
  }

  if (!editFilesEnabled && textEditorMaxCharacters !== undefined) {
    throw new Error('--text-editor-max-characters requires --edit-files.');
  }

  if (editFilesEnabled) {
    options.editFiles = {
      ...(textEditorMaxCharacters === undefined ? {} : { textEditorMaxCharacters }),
      ...(workspaceRoot === undefined ? {} : { workspaceRoot }),
    };
  }

  return { options, shouldPrintHelp: false };
}
