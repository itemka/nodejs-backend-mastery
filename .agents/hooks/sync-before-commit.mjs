// PreToolUse hook: run deterministic guardrails before a git commit.
// Only fires when the Bash command looks like `git commit`.

import { existsSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import { join } from 'node:path';

import { readStdinJson, repoRoot } from './lib/hook-utils.mjs';
import {
  commandIndex,
  commandName,
  gitSubcommandIndex,
  parseShellCommand,
} from './lib/shell-command.mjs';

const GUARDRAILS = [
  {
    name: 'check-secrets',
    command: 'node',
    args: ['scripts/check-secrets.mjs'],
  },
  {
    name: 'check-adapters',
    command: 'node',
    args: ['scripts/check-adapters.mjs'],
  },
  {
    name: 'sync-mcp',
    command: 'node',
    args: ['scripts/sync-mcp-to-codex.mjs'],
    blocking: false,
    shouldRun: (root) => existsSync(join(root, '.mcp.json')),
  },
];

const runGuardrail = ({ args, blocking = true, command, name, shouldRun }, root) => {
  if (shouldRun && !shouldRun(root)) return 0;

  process.stdout.write(`[hook] running ${name}\n`);
  const res = spawnSync(command, args, { cwd: root, stdio: 'inherit' });
  if (res.status === 0) return 0;

  if (!blocking) {
    process.stderr.write(`[hook] ${name} failed — continuing git commit\n`);
    return 0;
  }

  process.stderr.write(`[hook] ${name} failed — blocking git commit\n`);
  return 2;
};

const isGitCommit = (cmd) => {
  const { chunks, error } = parseShellCommand(cmd);
  if (error) return /\bgit\s+commit(?:\s|$)/.test(cmd);

  return chunks.some((tokens) => {
    const i = commandIndex(tokens);
    if (commandName(tokens[i]) !== 'git') return false;

    return tokens[gitSubcommandIndex(tokens, i)] === 'commit';
  });
};

const main = () => {
  const payload = readStdinJson();
  const cmd = payload?.tool_input?.command ?? '';
  // Restrict to `git commit` only — `commit-tree`, `commit-graph` etc. are plumbing.
  if (!isGitCommit(cmd)) return 0;

  const root = repoRoot(payload);

  for (const guardrail of GUARDRAILS) {
    const code = runGuardrail(guardrail, root);
    if (code !== 0) return code;
  }

  return 0;
};

process.exit(main());
