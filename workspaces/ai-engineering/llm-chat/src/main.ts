import { createProvider } from '@workspaces/packages/llm-client';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import type { BuiltinClientTool } from './chat/service.js';
import { createChatService } from './chat/service.js';
import { helpText, parseArgs } from './cli/args.js';
import type { EditFilesConfig } from './cli/args.js';
import { createReadlineInput } from './cli/readline.js';
import { runChatbot } from './cli/run-chatbot.js';
import { loadConfig, loadEnvironment } from './config/env.js';
import { llmChatTools } from './tools/registry.js';
import { createTextEditorRuntime } from './tools/text-editor/index.js';
import { createAppToolExecutionContext } from './tools/types.js';

const SYSTEM_PROMPT_BASE = 'Answer as shortly as possible.';
const TEMPERATURE = 0.2;
const STREAM = true;

function buildBuiltinClientTools(editFiles: EditFilesConfig): {
  builtinClientTools: BuiltinClientTool[];
  workspaceRoot: string;
} {
  const workspaceRoot = path.resolve(editFiles.workspaceRoot ?? process.cwd());
  const runtime = createTextEditorRuntime({
    workspaceRoot,
    ...(editFiles.textEditorMaxCharacters === undefined
      ? {}
      : { maxViewCharacters: editFiles.textEditorMaxCharacters }),
  });

  return { builtinClientTools: [{ definition: runtime.definition, runtime }], workspaceRoot };
}

async function main(): Promise<void> {
  const parsedArgs = parseArgs(process.argv.slice(2));

  if (parsedArgs.shouldPrintHelp) {
    console.log(helpText());

    return;
  }

  loadEnvironment();
  const config = loadConfig();
  const provider = createProvider(config);
  const { editFiles, ...chatOptions } = parsedArgs.options;
  const editFilesResult = editFiles === undefined ? undefined : buildBuiltinClientTools(editFiles);
  const builtinClientTools = editFilesResult?.builtinClientTools ?? [];
  const systemPrompt =
    editFilesResult === undefined
      ? SYSTEM_PROMPT_BASE
      : `${SYSTEM_PROMPT_BASE} File editing workspace root: "${editFilesResult.workspaceRoot}". Always use paths relative to this root (e.g. "src/main.ts") or absolute paths that start with this root.`;
  const chatService = createChatService({
    builtinClientTools,
    model: config.model,
    provider,
    systemPrompt,
    temperature: TEMPERATURE,
    toolContext: createAppToolExecutionContext(),
    tools: llmChatTools,
  });

  const input = createReadlineInput();

  try {
    await runChatbot({
      ...chatOptions,
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
