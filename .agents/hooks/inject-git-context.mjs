// UserPromptSubmit hook: prepend a short git context block so the agent always knows
// the branch and what's dirty before it responds. Stdout becomes injected context.

import { execFileSync } from 'node:child_process';

import { readStdinJson, repoRoot } from './lib/hook-utils.mjs';

const MAX_STATUS_LINES = 10;

const git = (args, root) => {
  try {
    // trimEnd, not trim: `git status --short` uses the leading column to mark
    // unstaged-only changes (" M file"), and trimming the left side flips it to staged.
    return execFileSync('git', args, { cwd: root, encoding: 'utf8' }).trimEnd();
  } catch {
    return '';
  }
};

const countDirty = (lines) => {
  let staged = 0;
  let unstaged = 0;
  let untracked = 0;
  for (const line of lines) {
    const x = line[0];
    const y = line[1];
    if (x === '?' && y === '?') {
      untracked += 1;
      continue;
    }
    if (x && x !== ' ') staged += 1;
    if (y && y !== ' ') unstaged += 1;
  }
  return { staged, unstaged, untracked };
};

const main = () => {
  const root = repoRoot(readStdinJson());
  const branch = git(['rev-parse', '--abbrev-ref', 'HEAD'], root) || '(detached)';
  const status = git(['status', '--short'], root);
  const lines = status ? status.split('\n') : [];

  process.stdout.write('<git-context>\n');
  process.stdout.write(`branch: ${branch}\n`);
  if (lines.length === 0) {
    process.stdout.write('status: clean\n');
  } else {
    const { staged, unstaged, untracked } = countDirty(lines);
    process.stdout.write(
      `dirty: ${lines.length} files (staged ${staged}, unstaged ${unstaged}, untracked ${untracked})\n`,
    );
    const shown = lines.slice(0, MAX_STATUS_LINES);
    const hidden = lines.length - shown.length;
    const overflow =
      hidden > 0 ? `\n…(+${hidden} more — run \`git status --short\` for full state)` : '';
    process.stdout.write(`status:\n${shown.join('\n')}${overflow}\n`);
  }
  process.stdout.write('</git-context>\n');
  return 0;
};

process.exit(main());
