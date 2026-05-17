// Ordered PreToolUse hook for shell commands.

import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import { readStdin, readStdinJson, repoRoot, runNodeHook } from './lib/hook-utils.mjs';

const hookDir = dirname(fileURLToPath(import.meta.url));
// Per-phase budgets keep a stuck phase from starving the next one. The adapter
// can still impose a wider overall timeout (`.codex/hooks.json`).
const HOOKS = [
  // deny check is pure JS + regex/parser work — should be near-instant.
  { name: 'deny-dangerous-bash.mjs', timeout: 5000 },
  // sync-before-commit shells out to check-secrets / check-adapters; needs
  // more headroom but is bounded.
  { name: 'sync-before-commit.mjs', timeout: 30_000 },
];

const raw = readStdin();
const root = repoRoot(readStdinJson(raw));

let code = 0;
for (const { name, timeout } of HOOKS) {
  code = runNodeHook(resolve(hookDir, name), raw, { root, timeout });
  if (code !== 0) break;
}

process.exit(code);
