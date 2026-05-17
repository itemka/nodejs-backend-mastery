// Ordered Stop hook: scoped typecheck first, then task-context guard.

import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import { readStdin, readStdinJson, repoRoot, runNodeHook } from './lib/hook-utils.mjs';

const hookDir = dirname(fileURLToPath(import.meta.url));
// Adapter caps stop-checks at 180s. Reserve the bulk of it for typecheck
// (which may build) and a small budget for the task-context guard.
const HOOKS = [
  { name: 'typecheck-changed.mjs', timeout: 150_000 },
  { name: 'check-task-context.mjs', timeout: 10_000 },
];

const raw = readStdin();
const root = repoRoot(readStdinJson(raw));

let code = 0;
for (const { name, timeout } of HOOKS) {
  code = runNodeHook(resolve(hookDir, name), raw, { root, timeout });
  if (code !== 0) break;
}

process.exit(code);
