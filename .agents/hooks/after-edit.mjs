// Ordered PostToolUse hook for file edits: format/lint first, then scoped tests.

import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import { readStdin, readStdinJson, repoRoot, runNodeHook } from './lib/hook-utils.mjs';

const hookDir = dirname(fileURLToPath(import.meta.url));
// Adapter caps after-edit at 120s. Split that budget so a hung format pass
// cannot eat the entire test budget (and vice versa).
const HOOKS = [
  { name: 'format-and-lint.mjs', timeout: 45_000 },
  { name: 'test-changed.mjs', timeout: 90_000 },
];

const raw = readStdin();
const root = repoRoot(readStdinJson(raw));

let code = 0;
for (const { name, timeout } of HOOKS) {
  code = runNodeHook(resolve(hookDir, name), raw, { root, timeout });
  if (code !== 0) break;
}

process.exit(code);
