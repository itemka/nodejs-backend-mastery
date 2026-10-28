import { McpServer } from '@modelcontextprotocol/server';

import type { BackupToolDeps } from './tools.js';
import { registerBackupTools } from './tools.js';

export const MCP_SERVER_NAME = 'notion-backup';

const instructions =
  'Starts and inspects the monthly backups of a Notion workspace to Google Drive. A backup runs for hours in the background after backup_start returns: follow it with backup_status. backup_retry, backup_cancel and backup_process act on one job; backup_health shows the last checks of each dependency.';

/** A new server for one request: `/mcp` is stateless, so nothing is shared between calls. */
export function createMcpServer(deps: BackupToolDeps & { readonly version: string }): McpServer {
  const server = new McpServer({ name: MCP_SERVER_NAME, version: deps.version }, { instructions });

  registerBackupTools(server, deps);

  return server;
}
