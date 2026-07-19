// Ordered Stop hook: scoped typecheck, then scoped tests, then task-context guard.

import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import { readStdin, readStdinJson, repoRoot, runNodeHook } from './lib/hook-utils.mjs';

const hookDir = dirname(fileURLToPath(import.meta.url));
// Adapter caps stop-checks at 180s. Split it across typecheck (which may
// build), the changed-workspace test run, and a small task-context budget:
// 85s + 70s + 10s = 165s, under the 180s outer cap.
const HOOKS = [
  { name: 'typecheck-changed.mjs', timeout: 85_000 },
  { name: 'test-changed-workspaces.mjs', timeout: 70_000 },
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
