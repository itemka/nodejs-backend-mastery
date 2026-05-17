// PostToolUse hook: run scoped tests when *.test.ts / *.spec.ts is edited.
// Scopes to the enclosing pnpm workspace; skips when the file is outside any package.

import { readStdinJson, repoRoot, resolveHookFilePath } from './lib/hook-utils.mjs';
import {
  packageWithScriptForFile,
  runPnpmScriptForPackages,
} from '../../scripts/lib/changed-workspaces.mjs';

const TEST_RE = /\.(?:test|spec)\.(?:m|c)?[jt]sx?$/i;

const main = () => {
  const payload = readStdinJson();
  const root = repoRoot(payload);
  const filePath = resolveHookFilePath(payload?.tool_input?.file_path, payload, root);
  if (typeof filePath !== 'string' || !TEST_RE.test(filePath)) return 0;

  const pkg = packageWithScriptForFile(filePath, 'test', { root });
  if (!pkg) return 0;

  const code = runPnpmScriptForPackages('test', [pkg.name], { root });
  if (code === 0) return 0;

  process.stderr.write(`[hook] scoped tests failed in ${pkg.name}; fix before continuing\n`);
  return 2;
};

process.exit(main());
