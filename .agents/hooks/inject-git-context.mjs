// UserPromptSubmit hook: prepend a short git context block so the agent always knows
// the branch and what's dirty before it responds. Stdout becomes injected context.

import { execFileSync } from 'node:child_process';

import { readStdinJson, repoRoot } from './lib/hook-utils.mjs';

const MAX_STATUS_LINES = 20;

const git = (args, root) => {
  try {
    return execFileSync('git', args, { cwd: root, encoding: 'utf8' }).trim();
  } catch {
    return '';
  }
};

const main = () => {
  const root = repoRoot(readStdinJson());
  const branch = git(['rev-parse', '--abbrev-ref', 'HEAD'], root) || '(detached)';
  const status = git(['status', '--short'], root);
  const lines = status ? status.split('\n') : [];
  const shown = lines.slice(0, MAX_STATUS_LINES);
  const overflow =
    lines.length > MAX_STATUS_LINES ? `\n…(+${lines.length - MAX_STATUS_LINES} more)` : '';

  process.stdout.write('<git-context>\n');
  process.stdout.write(`branch: ${branch}\n`);
  if (shown.length === 0) {
    process.stdout.write('status: clean\n');
  } else {
    process.stdout.write(`status:\n${shown.join('\n')}${overflow}\n`);
  }
  process.stdout.write('</git-context>\n');
  return 0;
};

process.exit(main());
