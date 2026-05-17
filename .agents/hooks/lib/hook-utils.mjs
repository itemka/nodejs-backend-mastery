import { spawnSync } from 'node:child_process';
import { existsSync, readFileSync } from 'node:fs';
import { isAbsolute, relative, resolve } from 'node:path';

import { repoRoot } from '../../../scripts/lib/repo.mjs';

export { git, repoRoot } from '../../../scripts/lib/repo.mjs';

export const readStdin = () => readFileSync(0, 'utf8');

export const readStdinJson = (raw = readStdin()) => {
  try {
    return JSON.parse(raw || '{}');
  } catch {
    return {};
  }
};

export const isInsideRoot = (path, root) => {
  const rel = relative(root, path);
  return rel === '' || (!rel.startsWith('..') && !isAbsolute(rel));
};

export const resolveHookFilePath = (filePath, payload, root) => {
  if (typeof filePath !== 'string' || !filePath.trim()) return null;
  if (isAbsolute(filePath)) {
    const absolutePath = resolve(filePath);
    return isInsideRoot(absolutePath, root) ? absolutePath : null;
  }

  const bases = [payload.cwd, process.cwd(), root]
    .filter((base) => base && existsSync(base))
    .map((base) => resolve(base))
    .filter((base) => isInsideRoot(base, root));

  const candidates = [...new Set(bases)].map((base) => resolve(base, filePath));
  const existing = candidates.find(
    (candidate) => existsSync(candidate) && isInsideRoot(candidate, root),
  );
  if (existing) return existing;

  return candidates.find((candidate) => isInsideRoot(candidate, root)) ?? null;
};

// Map every non-success outcome to exit 2 so the orchestrator surfaces it as a
// real block instead of a silent pass:
//   - spawn failure (ENOENT, EACCES, etc.) → block, with a clear stderr line
//   - signal kill (typically a hook-timeout SIGTERM) → block
//   - sub-hook exit 0 → pass through
//   - sub-hook exit 2 → pass through (intentional block)
//   - any other exit code → block, with the offending exit code
// Exit 1 is treated as a block because Claude/Codex policy feedback uses
// exit 2; an exit 1 from a sub-hook is almost certainly a JS crash or an
// unexpected error path we'd rather surface than silently swallow.
export const runNodeHook = (scriptPath, rawInput, { root, stdio = 'inherit', timeout } = {}) => {
  const res = spawnSync(process.execPath, [scriptPath], {
    cwd: root ?? repoRoot(),
    input: rawInput,
    stdio: ['pipe', stdio, stdio],
    timeout,
  });

  if (res.error) {
    process.stderr.write(
      `[hook] failed to spawn ${scriptPath}: ${res.error.code ?? res.error.message}\n`,
    );
    return 2;
  }
  if (res.signal) {
    process.stderr.write(`[hook] ${scriptPath} killed by ${res.signal} (likely timeout)\n`);
    return 2;
  }
  if (res.status === 0 || res.status === 2) return res.status;

  process.stderr.write(
    `[hook] ${scriptPath} exited with status ${res.status} — treating as block\n`,
  );
  return 2;
};
