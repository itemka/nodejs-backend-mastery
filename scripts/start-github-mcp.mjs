import { spawn } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { parseEnv } from 'node:util';

import { repoRoot } from './lib/repo.mjs';

const IMAGE = 'ghcr.io/github/github-mcp-server:v1.12.2';

const main = () => {
  const root = repoRoot();
  const explicitFile = process.env.MCP_ENV_FILE;
  let fileValues = {};
  try {
    fileValues = parseEnv(readFileSync(resolve(root, explicitFile || '.mcp.env'), 'utf8'));
  } catch (error) {
    if (explicitFile || error?.code !== 'ENOENT') {
      throw new Error('Cannot read the private MCP env file. Check MCP_ENV_FILE or .mcp.env.');
    }
  }

  const token = process.env.GITHUB_TOKEN || fileValues.GITHUB_TOKEN;
  if (!token?.trim()) {
    throw new Error('GITHUB_TOKEN is missing. Set it in .mcp.env or export it.');
  }
  if (process.env.GITHUB_TOKEN && fileValues.GITHUB_TOKEN !== process.env.GITHUB_TOKEN) {
    console.error('start-github-mcp: exported GITHUB_TOKEN overrides .mcp.env');
  }

  const env = { ...process.env, GITHUB_PERSONAL_ACCESS_TOKEN: token };
  if (process.platform === 'darwin') {
    env.PATH = [env.PATH, '/usr/local/bin', '/opt/homebrew/bin'].filter(Boolean).join(':');
  }
  const child = spawn(
    'docker',
    ['run', '-i', '--rm', '-e', 'GITHUB_PERSONAL_ACCESS_TOKEN', IMAGE],
    {
      cwd: root,
      env,
      stdio: 'inherit',
    },
  );
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
    console.error(
      'start-github-mcp: Could not start Docker. Check that it is installed and running.',
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
  console.error(`start-github-mcp: ${error.message}`);
  process.exitCode = 1;
}
