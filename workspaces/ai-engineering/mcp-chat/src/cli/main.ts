import { createProvider, loadConfig, loadEnvironment } from '@workspaces/packages/llm-client';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { createChatSession } from '../chat/chat-session.js';
import { listKnownDocumentIds } from '../chat/document-context.js';
import { createMcpToolManager } from '../chat/mcp-tool-manager.js';
import { connectMcpStdioClient } from '../client/mcp-client.js';
import { helpText, parseArgs } from './args.js';
import { createReadlineInput } from './readline.js';
import { runChatbot } from './run-chatbot.js';

const SYSTEM_PROMPT = [
  'You are an assistant that helps the user reason about a small set of in-memory documents.',
  'Use the MCP tools (read_doc_contents, edit_document) when they are useful.',
  'When the user mentions @<doc_id>, the referenced document is included in the user turn.',
].join(' ');

const WORKSPACE_ROOT = path.resolve(fileURLToPath(new URL('../..', import.meta.url)));

function resolveServerCommand(useDevServer: boolean): {
  args: readonly string[];
  command: string;
} {
  if (useDevServer) {
    return {
      args: [path.join(WORKSPACE_ROOT, 'src/server/main.ts')],
      command: path.join(WORKSPACE_ROOT, 'node_modules/.bin/tsx'),
    };
  }

  return { args: [path.join(WORKSPACE_ROOT, 'dist/server/main.js')], command: process.execPath };
}

function buildCompleter(documents: readonly string[], prompts: readonly string[]) {
  return (line: string): readonly [readonly string[], string] => {
    if (line.startsWith('/')) {
      const prefix = line.slice(1);
      const hits = prompts.filter((name) => name.startsWith(prefix)).map((name) => `/${name}`);

      return [hits, line];
    }

    if (line.startsWith('@')) {
      const prefix = line.slice(1);
      const hits = documents.filter((id) => id.startsWith(prefix)).map((id) => `@${id}`);

      return [hits, line];
    }

    return [[], line];
  };
}

async function main(): Promise<void> {
  const parsed = parseArgs(process.argv.slice(2));

  if (parsed.shouldPrintHelp) {
    console.log(helpText());

    return;
  }

  loadEnvironment(path.join(WORKSPACE_ROOT, '.env'));
  const config = loadConfig();
  const provider = createProvider(config);

  const { args, command } = resolveServerCommand(parsed.useDevServer);
  const documentServer = await connectMcpStdioClient({
    server: {
      args: [...args],
      command,
      cwd: WORKSPACE_ROOT,
    },
  });

  try {
    const toolManager = await createMcpToolManager({
      clients: [
        {
          client: documentServer,
          name: 'document-mcp-server',
        },
      ],
    });

    const session = createChatSession({
      model: config.model,
      provider,
      systemPrompt: SYSTEM_PROMPT,
      temperature: 0.2,
      toolManager,
    });

    const [documents, prompts] = await Promise.all([
      listKnownDocumentIds(documentServer),
      documentServer.listPrompts(),
    ]);

    const input = createReadlineInput({
      completer: buildCompleter(
        documents,
        prompts.map((p) => p.name),
      ),
    });

    try {
      await runChatbot({
        documentServer,
        input: (prompt) => input.ask(prompt),
        session,
        stream: parsed.stream,
        ...(parsed.maxTokens === undefined ? {} : { maxTokens: parsed.maxTokens }),
      });
    } finally {
      input.close();
    }
  } finally {
    await documentServer.close();
  }
}

export function isDirectExecution(moduleUrl: string, entrypointPath: string | undefined): boolean {
  return entrypointPath !== undefined && fileURLToPath(moduleUrl) === path.resolve(entrypointPath);
}

if (isDirectExecution(import.meta.url, process.argv[1])) {
  await main();
}
