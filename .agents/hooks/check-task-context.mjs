// Stop hook: nudge to keep docs/CURRENT_TASK_CONTEXT.md fresh.
// Advisory only — always exits 0. Emits a system message when the file is
// missing or stale in a dirty worktree.

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
    writeSystemMessage(
      `[hook] reminder: ${CTX} is missing — add a compact handoff if work continues across sessions. See ${SKILL_HINT}`,
    );
    return 0;
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
