import { spawn } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { parseEnv } from 'node:util';

import * as ui from '@workspaces/cli-output';

import { repoRoot } from './lib/repo.mjs';

const HELP = `Usage: pnpm mcp:run [--] <command> [args...]

Loads the repo-root .mcp.env into the launched command, not the calling shell.
Everything that command spawns inherits the values, including every MCP server and
every shell command an agent runs, so use least-privilege tokens.
Set MCP_ENV_FILE to use a different private file: keep it outside the repo, or name it
.mcp.<name>.env in the repo root, which Git ignores (relative paths use the repo root).
Already-exported variables take precedence. Missing shared MCP variables fail before launch.
The env file is parsed as data; shell commands and variable substitution are not evaluated.

Examples:
  pnpm mcp:run codex
  pnpm mcp:run claude
  pnpm mcp:run code .
  pnpm mcp:run claude --mcp-config .mcp.local.json

Fully quit an existing editor before launching it with a new environment.`;

const loadEnvironment = (root) => {
  const file = resolve(root, process.env.MCP_ENV_FILE || '.mcp.env');
  let values;
  try {
    values = parseEnv(readFileSync(file, 'utf8'));
  } catch {
    throw new Error(
      'Cannot read the private MCP env file. Create .mcp.env from .mcp.env.example or set MCP_ENV_FILE.',
    );
  }

  // Parse errors can quote the file's contents, so never surface the raw error.
  let config;
  try {
    config = JSON.parse(readFileSync(resolve(root, '.mcp.json'), 'utf8'));
  } catch {
    config = undefined;
  }
  if (
    !config?.mcpServers ||
    typeof config.mcpServers !== 'object' ||
    Array.isArray(config.mcpServers)
  ) {
    throw new Error('Cannot read the shared .mcp.json. Restore it and run pnpm check:mcp.');
  }

  const env = { ...values, ...process.env };
  const required = new Set();
  for (const server of Object.values(config.mcpServers)) {
    for (const value of [
      ...Object.values(server.env ?? {}),
      ...Object.values(server.headers ?? {}),
    ]) {
      if (typeof value !== 'string') continue;
      for (const match of value.matchAll(/\$\{([A-Za-z_][A-Za-z0-9_]*)\}/g)) required.add(match[1]);
    }
  }
  const missing = [...required].filter((name) => !env[name]?.trim());
  if (missing.length > 0)
    throw new Error(
      `Missing MCP environment variables: ${missing.join(', ')}. Set them in the private env file or export them before launch.`,
    );
  return env;
};

const main = () => {
  const args = process.argv.slice(2);
  if (args[0] === '--') args.shift();
  if (args[0] === '--help' || args[0] === '-h') {
    console.log(HELP);
    return;
  }
  const command = args.shift();
  if (!command || command.startsWith('-'))
    throw new Error('Provide a command to launch. Use pnpm mcp:run --help for usage.');
  const root = repoRoot();
  const env = loadEnvironment(root);
  const child = spawn(command, args, { cwd: root, env, stdio: 'inherit' });
  const handlers = new Map();
  for (const signal of ['SIGINT', 'SIGTERM', 'SIGHUP']) {
    const handler = () => child.kill(signal);
    handlers.set(signal, handler);
    process.on(signal, handler);
  }
  const cleanup = () => {
    for (const [signal, handler] of handlers) process.off(signal, handler);
  };
  child.once('error', () => {
    cleanup();
    // Do not echo command arguments, env values, or raw child-process errors.
    console.error(
      ui.error('Could not start the requested command. Check that it is installed and executable.'),
    );
    process.exitCode = 1;
  });
  child.once('exit', (code, signal) => {
    cleanup();
    if (signal) process.kill(process.pid, signal);
    else process.exitCode = code ?? 1;
  });
};

try {
  main();
} catch (error) {
  console.error(ui.error(`mcp:run failed: ${error.message}`));
  process.exitCode = 1;
}
