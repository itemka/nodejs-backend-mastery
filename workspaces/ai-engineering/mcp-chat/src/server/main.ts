import { StdioServerTransport } from '@modelcontextprotocol/server';
import * as ui from '@workspaces/cli-output';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { createDocumentStore } from '../documents/document-store.js';
import { SEED_DOCUMENTS } from '../documents/seed-documents.js';
import { createDocumentMcpServer } from './document-mcp-server.js';

async function main(): Promise<void> {
  const store = createDocumentStore(SEED_DOCUMENTS);
  const server = createDocumentMcpServer(store);
  const transport = new StdioServerTransport();

  let shuttingDown = false;

  const shutdown = (signal: NodeJS.Signals): void => {
    if (shuttingDown) {
      return;
    }

    shuttingDown = true;
    console.error(
      `${ui.prefix('[document-mcp-server]')} ${ui.muted(`received ${signal}, shutting down`)}`,
    );
    server.close().catch((error: unknown) => {
      console.error(`${ui.prefix('[document-mcp-server]')} ${ui.error('shutdown error:')}`, error);
      process.exitCode = 1;
    });
  };

  process.on('SIGINT', shutdown);
  process.on('SIGTERM', shutdown);

  await server.connect(transport);
}

export function isDirectExecution(moduleUrl: string, entrypointPath: string | undefined): boolean {
  return entrypointPath !== undefined && fileURLToPath(moduleUrl) === path.resolve(entrypointPath);
}

if (isDirectExecution(import.meta.url, process.argv[1])) {
  await main();
}
