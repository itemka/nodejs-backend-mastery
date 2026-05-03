import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { helpText, parseArgs } from './cli/args.js';
import { runEvalCli } from './cli/run-eval.js';

async function main(): Promise<void> {
  const parsed = parseArgs(process.argv.slice(2));

  if (parsed.shouldPrintHelp || !parsed.options) {
    console.log(helpText());

    return;
  }

  await runEvalCli(parsed.options);
}

export function isDirectExecution(moduleUrl: string, entrypointPath: string | undefined): boolean {
  return entrypointPath !== undefined && fileURLToPath(moduleUrl) === path.resolve(entrypointPath);
}

if (isDirectExecution(import.meta.url, process.argv[1])) {
  await main();
}
