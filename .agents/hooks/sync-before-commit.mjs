// PreToolUse hook: run deterministic guardrails before a git commit.
// Only fires when the Bash command looks like `git commit`.

import { spawnSync } from 'node:child_process';

import { readStdinJson, repoRoot } from './lib/hook-utils.mjs';
import {
  commandIndex,
  commandName,
  gitSubcommandIndex,
  parseShellCommand,
} from './lib/shell-command.mjs';

const GUARDRAILS = [
  {
    name: 'check-secrets',
    command: 'node',
    args: ['scripts/check-secrets.mjs'],
  },
  {
    name: 'check-adapters',
    command: 'node',
    args: ['scripts/check-adapters.mjs'],
  },
  {
    name: 'check-mcp',
    command: 'node',
    args: ['scripts/sync-mcp-to-codex.mjs', '--check', '--staged'],
  },
];

const COMMIT_VALUE_OPTIONS = new Set([
  '--author',
  '--cleanup',
  '--date',
  '--file',
  '--fixup',
  '--message',
  '--reedit-message',
  '--reuse-message',
  '--squash',
  '--template',
  '--trailer',
]);
const COMMIT_FLAG_OPTIONS = new Set([
  '--allow-empty',
  '--allow-empty-message',
  '--amend',
  '--dry-run',
  '--edit',
  '--no-edit',
  '--no-gpg-sign',
  '--no-post-rewrite',
  '--no-signoff',
  '--no-status',
  '--no-verify',
  '--quiet',
  '--reset-author',
  '--signoff',
  '--status',
  '--verbose',
]);

// Accept only options whose commit content comes from the current index.
// Git's -a/-i/-o, pathspecs, and interactive modes prepare a different index
// after PreToolUse has already run. Unknown options fail closed, including
// abbreviated long options; the error tells the caller how to proceed.
const usesCurrentIndex = (args) => {
  for (let i = 0; i < args.length; i++) {
    const arg = args[i];
    if (arg === '--') return i === args.length - 1;
    if (arg.startsWith('--')) {
      const [name] = arg.split('=', 1);
      if (COMMIT_VALUE_OPTIONS.has(name)) {
        if (!arg.includes('=') && ++i >= args.length) return false;
        const value = arg.includes('=') ? arg.slice(arg.indexOf('=') + 1) : args[i];
        if (name === '--fixup' && value.startsWith('reword:')) return false;
      } else if (name !== '--gpg-sign' && !COMMIT_FLAG_OPTIONS.has(arg)) return false;
      continue;
    }
    if (!arg.startsWith('-') || arg === '-') return false;
    for (let j = 1; j < arg.length; j++) {
      const flag = arg[j];
      if ('mFCct'.includes(flag)) {
        if (j === arg.length - 1 && ++i >= args.length) return false;
        break;
      }
      if (flag === 'S') break; // The optional signing key must be attached.
      if (!'qvens'.includes(flag)) return false;
    }
  }
  return true;
};

// The shared shell parser flattens glob tokens and leaves brace expansion to
// the shell. Either can turn one option value into extra flags or pathspecs.
// `$` and backticks also expand inside double quotes; single quotes keep
// everything literal, so a message like 'handle `null`' stays checkable.
const hasShellExpansion = (cmd) => {
  let quote;
  for (let i = 0; i < cmd.length; i++) {
    const char = cmd[i];
    if (quote === "'") {
      if (char === quote) quote = undefined;
    } else if (char === '\\') {
      i++;
    } else if (char === '$' || char === '`') {
      return true;
    } else if (quote) {
      if (char === quote) quote = undefined;
    } else if (char === "'" || char === '"') {
      quote = char;
    } else if ('*?[]{}'.includes(char)) {
      return true;
    }
  }
  return false;
};

const runGuardrail = ({ args, command, name }, root) => {
  process.stdout.write(`[hook] running ${name}\n`);
  const res = spawnSync(command, args, { cwd: root, stdio: 'inherit', timeout: 30_000 });
  if (res.status === 0) return 0;

  process.stderr.write(`[hook] ${name} failed — blocking git commit\n`);
  return 2;
};

const commitInvocation = (cmd) => {
  const { chunks, error } = parseShellCommand(cmd);
  if (error) return { found: /\bgit\s+commit(?:\s|$)/.test(cmd), safe: false };

  const commits = chunks.filter((tokens) => {
    const i = commandIndex(tokens);
    if (commandName(tokens[i]) !== 'git') return false;

    return tokens[gitSubcommandIndex(tokens, i)] === 'commit';
  });
  if (commits.length === 0) return { found: false };
  const tokens = commits[0];
  return {
    found: true,
    // Separate tool calls ensure staging, wrappers, redirections, shell
    // substitutions, and repo/index overrides cannot change what was checked.
    safe:
      chunks.length === 1 &&
      tokens[0] === 'git' &&
      tokens[1] === 'commit' &&
      !hasShellExpansion(cmd) &&
      usesCurrentIndex(tokens.slice(2)),
  };
};

const main = () => {
  const payload = readStdinJson();
  const cmd = payload?.tool_input?.command ?? '';
  // Restrict to `git commit` only — `commit-tree`, `commit-graph` etc. are plumbing.
  const invocation = commitInvocation(cmd);
  if (!invocation.found) return 0;
  if (!invocation.safe) {
    process.stderr.write(
      "[hook] Stage changes in a separate tool call, then run standalone git commit using the existing index. Commit pathspecs, index-changing or unknown options, shell expansions, wrappers, and compound commands cannot be checked before execution. Single-quoted text is literal and allowed. For a multi-line message, repeat -m or --trailer, or pass -F <file>; a newline inside -m or a $(cat <<'EOF' ...) heredoc is rejected.\n",
    );
    return 2;
  }

  const root = repoRoot(payload);

  for (const guardrail of GUARDRAILS) {
    const code = runGuardrail(guardrail, root);
    if (code !== 0) return code;
  }

  return 0;
};

process.exit(main());
