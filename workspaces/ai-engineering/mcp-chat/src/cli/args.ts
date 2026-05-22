export interface ParsedArgs {
  readonly maxTokens?: number;
  readonly shouldPrintHelp: boolean;
  readonly stream: boolean;
  readonly useDevServer: boolean;
}

export function helpText(): string {
  return [
    'Usage: mcp-chat [options]',
    '',
    'Options:',
    '  --help, -h             Print this help text and exit.',
    '  --no-stream            Disable assistant streaming output.',
    '  --max-tokens <n>       Maximum tokens per assistant response (default 1024).',
    '  --server-dev           Launch the MCP server with tsx (TypeScript source).',
    '',
    'Built-in commands inside the REPL:',
    '  /                      List available MCP prompts/commands.',
    '  @                      List available document ids.',
    '  /format <doc_id>       Run the format prompt for the given document.',
    '  @<doc_id>              Mention a document to include its content in the next turn.',
    '  exit                   Exit the chatbot.',
  ].join('\n');
}

export function parseArgs(argv: readonly string[]): ParsedArgs {
  let stream = true;
  let useDevServer = false;
  let maxTokens: number | undefined;
  let shouldPrintHelp = false;

  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];

    if (arg === '--help' || arg === '-h') {
      shouldPrintHelp = true;
      continue;
    }

    if (arg === '--no-stream') {
      stream = false;
      continue;
    }

    if (arg === '--server-dev') {
      useDevServer = true;
      continue;
    }

    if (arg === '--max-tokens') {
      const next = argv[i + 1];

      if (next === undefined) {
        throw new Error('--max-tokens requires a numeric argument.');
      }

      const parsed = Number(next);

      if (!/^\d+$/.test(next) || !Number.isSafeInteger(parsed) || parsed <= 0) {
        throw new Error(`--max-tokens must be a positive integer, got "${next}".`);
      }

      maxTokens = parsed;
      i += 1;
      continue;
    }

    throw new Error(`Unknown argument: ${String(arg)}`);
  }

  return {
    ...(maxTokens === undefined ? {} : { maxTokens }),
    shouldPrintHelp,
    stream,
    useDevServer,
  };
}
