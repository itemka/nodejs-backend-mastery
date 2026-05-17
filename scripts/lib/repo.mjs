// Shared repo-root and git helpers. Used by both `scripts/` and the agent
// lifecycle hooks so we maintain one canonical repo-root detection that
// honors CLAUDE_PROJECT_DIR / CODEX_PROJECT_DIR and the hook payload `cwd`.

import { execFileSync } from 'node:child_process';
import { existsSync } from 'node:fs';
import { resolve } from 'node:path';

const candidateRoots = (payload = {}) => [
  process.env.CLAUDE_PROJECT_DIR,
  process.env.CODEX_PROJECT_DIR,
  payload.cwd,
  process.cwd(),
];

export const repoRoot = (payload = {}) => {
  for (const candidate of candidateRoots(payload)) {
    if (!candidate || !existsSync(candidate)) continue;

    try {
      return execFileSync('git', ['rev-parse', '--show-toplevel'], {
        cwd: candidate,
        encoding: 'utf8',
      }).trim();
    } catch {
      /* try the next candidate */
    }
  }

  return resolve(process.cwd());
};

export const git = (args, { root } = {}) => {
  try {
    return execFileSync('git', args, { cwd: root ?? repoRoot(), encoding: 'utf8' });
  } catch {
    return '';
  }
};
