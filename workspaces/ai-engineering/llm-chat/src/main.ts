import { createProvider } from '@workspaces/packages/llm-client';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { createChatService } from './chat/service.js';
import { helpText, parseArgs } from './cli/args.js';
import { createReadlineInput } from './cli/readline.js';
import { runChatbot } from './cli/run-chatbot.js';
import { loadConfig, loadEnvironment } from './config/env.js';

const SYSTEM_PROMPT = 'Answer as shortly as possible.';
const TEMPERATURE = 0.2;
const STREAM = true;

async function main(): Promise<void> {
  const parsedArgs = parseArgs(process.argv.slice(2));

  if (parsedArgs.shouldPrintHelp) {
    console.log(helpText());

    return;
  }

  loadEnvironment();
  const config = loadConfig();
  const provider = createProvider(config);
  const chatService = createChatService({
    model: config.model,
    provider,
    systemPrompt: SYSTEM_PROMPT,
    temperature: TEMPERATURE,
  });

  const input = createReadlineInput();

  try {
    await runChatbot({
      ...parsedArgs.options,
      input: (prompt) => input.ask(prompt),
      runTurn: (messages, text, options) => chatService.sendUserTurn(messages, text, options),
      stream: STREAM,
    });
  } finally {
    input.close();
  }
}

export function isDirectExecution(moduleUrl: string, entrypointPath: string | undefined): boolean {
  return entrypointPath !== undefined && fileURLToPath(moduleUrl) === path.resolve(entrypointPath);
}

if (isDirectExecution(import.meta.url, process.argv[1])) {
  await main();
}
