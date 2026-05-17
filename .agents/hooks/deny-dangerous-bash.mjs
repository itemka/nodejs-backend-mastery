// PreToolUse hook on Bash: block irreversible / repo-wrecking commands.
// Exit 2 returns the reason to the agent so it can pick a safer approach.

import { readStdinJson } from './lib/hook-utils.mjs';
import {
  commandIndex,
  commandName,
  expandBraces,
  gitSubcommandIndex,
  parseShellCommand,
} from './lib/shell-command.mjs';

// `rm` is checked separately so we can detect recursive+force flags in any
// order (`-rf`, `-fr`, `-Rf`, `-r -f`, `--recursive --force`) and any
// dangerous target. The earlier regex required `r` strictly before `f`, which
// missed common BSD/GNU equivalents.
const DANGEROUS_RM_TARGETS = [
  { match: (t) => t === '/', label: '/' },
  { match: (t) => t === '.' || t === './', label: 'current directory' },
  {
    match: (t) => BROAD_CURRENT_DIR_GLOBS.has(t),
    label: 'current directory glob',
  },
  { match: (t) => t === '~' || t.startsWith('~/'), label: '$HOME' },
  { match: (t) => t === '$HOME' || t.startsWith('$HOME/'), label: '$HOME' },
  { match: (t) => t === '..' || t.startsWith('../'), label: '.. (escapes the repo)' },
  { match: (t) => t === '.git' || t.startsWith('.git/'), label: '.git' },
];

const BROAD_CURRENT_DIR_GLOBS = new Set([
  '*',
  './*',
  '*/',
  './*/',
  '[!.]*',
  './[!.]*',
  '.*',
  './.*',
  '.?*',
  './.?*',
  '.[!.]*',
  './.[!.]*',
  '.??*',
  './.??*',
  '..?*',
  './..?*',
]);

// A positional is "unresolved" when shell-quote could not statically reduce
// it to a literal path — typically `$(…)` (which leaves a bare `$` after the
// parser splits on `(`/`)`) or a backtick expression. We fail closed on these
// when combined with rm -rf because the agent could be hiding any path here.
const UNRESOLVED_RE = /[`$]/;

const isUnresolvedPositional = (token) => token === '$' || UNRESOLVED_RE.test(token);

const matchesDangerousTarget = (token) => {
  for (const candidate of expandBraces(token)) {
    const hit = DANGEROUS_RM_TARGETS.find(({ match }) => match(candidate));
    if (hit) return hit.label;
  }
  return null;
};

const findDangerousRm = (tokens) => {
  const i = commandIndex(tokens);
  const head = tokens[i];
  if (commandName(head) !== 'rm') return null;

  let recursive = false;
  let force = false;
  const positionals = [];

  for (let j = i + 1; j < tokens.length; j++) {
    const token = tokens[j];
    if (token === '--') {
      positionals.push(...tokens.slice(j + 1));
      break;
    }
    if (token === '--recursive' || token === '-r' || token === '-R') recursive = true;
    else if (token === '--force') force = true;
    else if (/^-[A-Za-z]+$/.test(token)) {
      if (/[rR]/.test(token)) recursive = true;
      if (/[fF]/.test(token)) force = true;
    } else if (!token.startsWith('-')) {
      positionals.push(token);
    }
  }

  if (!recursive || !force) return null;

  for (const target of positionals) {
    const label = matchesDangerousTarget(target);
    if (label) return label;
  }

  // `rm -rf` with no resolvable positional — either no positional at all or
  // a positional the parser could not statically reduce (command substitution,
  // backticks). Fail closed; this is exactly the shape an adversarial agent
  // would use to slip past a literal-target allowlist.
  if (positionals.length === 0 || positionals.some((p) => isUnresolvedPositional(p))) {
    return '(target unresolved — likely command substitution; ask the user)';
  }

  return null;
};

const findDangerousGit = (tokens) => {
  const i = commandIndex(tokens);
  if (commandName(tokens[i]) !== 'git') return null;

  const subcommandIndex = gitSubcommandIndex(tokens, i);
  const subcommand = tokens[subcommandIndex];
  const args = tokens.slice(subcommandIndex + 1);

  if (subcommand === 'reset' && args.includes('--hard')) {
    return 'git reset --hard (destroys uncommitted work)';
  }

  if (
    subcommand === 'push' &&
    args.some(
      (arg) =>
        arg === '--force' ||
        arg.startsWith('--force=') ||
        (/^-[A-Za-z]+$/.test(arg) && arg.includes('f')),
    )
  ) {
    return 'git push --force (use --force-with-lease if absolutely required)';
  }

  return null;
};

const block = (label, cmd) => {
  process.stderr.write(
    `[hook] blocked: ${label}\nCommand: ${cmd}\nAsk the user to run it manually if this is truly intended.\n`,
  );
  return 2;
};

const main = () => {
  const cmd = readStdinJson()?.tool_input?.command;
  if (typeof cmd !== 'string') return 0;

  const { chunks, error } = parseShellCommand(cmd);
  if (error) {
    return block('unparseable shell command; ask the user before running risky shell syntax', cmd);
  }

  for (const tokens of chunks) {
    const gitRisk = findDangerousGit(tokens);
    if (gitRisk) return block(gitRisk, cmd);

    const rmTarget = findDangerousRm(tokens);
    if (rmTarget) return block(`rm -rf ${rmTarget}`, cmd);
  }

  return 0;
};

process.exit(main());
