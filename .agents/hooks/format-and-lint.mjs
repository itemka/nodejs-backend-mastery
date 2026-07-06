// PostToolUse hook: format and auto-fix TS/JS files after Edit/Write.
// Exit 0 silent on success; exit 2 surfaces unfixable issues to the agent.

import { spawnSync } from 'node:child_process';
import { relative, sep } from 'node:path';

import { readStdinJson, repoRoot, resolveHookFilePath } from './lib/hook-utils.mjs';

const TS_JS_RE = /\.(?:m|c)?[jt]sx?$/i;
const SKIP_DIRS = new Set(['node_modules', 'dist', 'build', '.git', '.pnpm-store']);

const main = () => {
  const payload = readStdinJson();
  const filePath = payload?.tool_input?.file_path;
  if (typeof filePath !== 'string') return 0;

  const root = repoRoot(payload);
  const abs = resolveHookFilePath(filePath, payload, root);
  if (!abs) return 0;

  if (!TS_JS_RE.test(abs)) return 0;
  if (abs.split(sep).some((part) => SKIP_DIRS.has(part))) return 0;

  const rel = relative(root, abs);
  const opts = { cwd: root, stdio: 'inherit' };

  const prettier = spawnSync(
    'pnpm',
    ['exec', 'prettier', '--write', '--log-level=error', rel],
    opts,
  );
  if (prettier.status !== 0) {
    process.stderr.write(`[hook] prettier failed for ${rel}\n`);
    return 2;
  }

  const eslint = spawnSync('pnpm', ['exec', 'eslint', '--fix', '--no-warn-ignored', rel], opts);
  if (eslint.status !== 0) {
    process.stderr.write(`[hook] eslint reported unfixable issues in ${rel}\n`);
    return 2;
  }

  return 0;
};

process.exit(main());
