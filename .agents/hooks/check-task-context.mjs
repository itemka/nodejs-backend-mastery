// Stop hook: enforce docs/CURRENT_TASK_CONTEXT.md before the session ends.
// Exits 2 (blocking) when the file is missing; nudges (exit 0) when stale.
// stop_hook_active guard prevents an infinite loop on the second Stop attempt.

import { execFileSync } from 'node:child_process';
import { existsSync, statSync } from 'node:fs';
import { resolve } from 'node:path';

import { readStdinJson, repoRoot } from './lib/hook-utils.mjs';

const CTX = 'docs/CURRENT_TASK_CONTEXT.md';
const SKILL_HINT = '.agents/skills/current-task-context/SKILL.md';
const STALE_GRACE_MS = 60_000;

const git = (args, root) => {
  try {
    return execFileSync('git', args, { cwd: root, encoding: 'utf8' });
  } catch {
    return '';
  }
};

// Surface a non-blocking reminder. Claude Code Stop hooks render
// `{"systemMessage": "..."}` from stdout as a system notice; Codex Stop hooks
// do not parse that contract, so fall back to a stderr `[hook]` line there.
// Either way we exit 0 — this is a nudge, not a block.
const writeSystemMessage = (message) => {
  if (process.env.CLAUDE_PROJECT_DIR) {
    process.stdout.write(`${JSON.stringify({ systemMessage: message })}\n`);
    return;
  }
  process.stderr.write(`${message}\n`);
};

const main = () => {
  const payload = readStdinJson();
  const root = repoRoot(payload);
  const dirty = git(['status', '--porcelain'], root).trim().length > 0;
  if (!dirty) return 0;

  const ctxPath = resolve(root, CTX);
  if (!existsSync(ctxPath)) {
    // Already in a stop-hook retry loop — don't block indefinitely.
    if (payload?.stop_hook_active) return 0;
    process.stderr.write(
      `[hook] ${CTX} is missing — create it before stopping. See ${SKILL_HINT}\n`,
    );
    return 2;
  }

  const ctxMtime = statSync(ctxPath).mtimeMs;
  let newest = 0;
  const changedFiles = [
    ...git(['diff', '--name-only', 'HEAD'], root).split('\n'),
    ...git(['ls-files', '--others', '--exclude-standard'], root).split('\n'),
  ].filter(Boolean);

  for (const f of new Set(changedFiles)) {
    try {
      newest = Math.max(newest, statSync(resolve(root, f)).mtimeMs);
    } catch {
      /* ignore deleted */
    }
  }

  if (newest > ctxMtime + STALE_GRACE_MS) {
    writeSystemMessage(
      `[hook] reminder: ${CTX} is stale relative to recent edits — see ${SKILL_HINT}`,
    );
  }
  return 0;
};

process.exit(main());
