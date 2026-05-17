# Hook Runbook

Portable Node.js hook scripts for Codex and Claude Code live in this folder.
Tool adapters stay thin:

- Codex wiring: [../../.codex/hooks.json](../../.codex/hooks.json)
- Claude wiring: [../../.claude/settings.json](../../.claude/settings.json)

Shared hook design guidance lives in
[../skills/designing-hooks/SKILL.md](../skills/designing-hooks/SKILL.md).

## Current Hooks

`deny-dangerous-bash.mjs`
: Event: `PreToolUse`
: Tools: Codex `Bash|shell`; Claude `Bash`
: Runs when: a shell command is about to run
: Blocks: yes, exits `2` for destructive patterns

`before-bash.mjs`
: Event: `PreToolUse`
: Tools: Codex `Bash|shell`; Claude `Bash`
: Runs when: a shell command is about to run
: Blocks: yes, runs `deny-dangerous-bash.mjs` before commit guardrails

`sync-before-commit.mjs`
: Event: `PreToolUse`
: Tools: Codex `Bash|shell`; Claude `Bash`
: Runs when: command contains `git commit`
: Blocks: yes for secret and adapter checks; MCP sync is best effort

`after-edit.mjs`
: Event: `PostToolUse`
: Tools: Codex `Edit|MultiEdit|Write|apply_patch`; Claude `Edit|MultiEdit|Write`
: Runs when: a file edit tool succeeds
: Blocks/feedback: yes, runs format/lint before scoped test checks

`format-and-lint.mjs`
: Event: `PostToolUse`
: Tools: Codex `Edit|MultiEdit|Write|apply_patch`; Claude `Edit|MultiEdit|Write`
: Runs when: edited file is JS/TS and not in ignored build folders
: Blocks: yes, exits `2` if Prettier or ESLint cannot fix

`test-changed.mjs`
: Event: `PostToolUse`
: Tools: same edit events as format/lint
: Runs when: edited file is `*.test.*` or `*.spec.*` inside a package with `test`
: Blocks: yes, returns the scoped test command status

`inject-git-context.mjs`
: Event: `UserPromptSubmit`
: Tools: Codex and Claude
: Runs when: every user prompt
: Blocks: no, prints branch and short status as injected context

`typecheck-changed.mjs`
: Event: `Stop`
: Tools: Codex and Claude
: Runs when: Stop event, unless `stop_hook_active` is true
: Blocks: yes, exits `2` when scoped typecheck fails

`stop-checks.mjs`
: Event: `Stop`
: Tools: Codex and Claude
: Runs when: Stop event
: Blocks: yes, runs scoped typecheck before task-context guard

`check-task-context.mjs`
: Event: `Stop`
: Tools: Codex and Claude
: Runs when: dirty worktree at stop
: Blocks: yes only when `docs/CURRENT_TASK_CONTEXT.md` is missing on first stop attempt; stale context is a warning

## Adapter Notes

- Codex supports `timeout` and `statusMessage` in `.codex/hooks.json`.
- Codex currently skips command handlers marked with `async: true`; keep shared
  command hooks synchronous unless the Codex adapter intentionally omits them.
- Claude matcher strings such as `Edit|MultiEdit|Write` are exact alternatives.
  Codex matchers in this repo use regular expressions for likely tool aliases.
- Adapter commands must locate the repo root before invoking portable scripts.
  Claude uses `$CLAUDE_PROJECT_DIR`; Codex assigns `git rev-parse --show-toplevel`
  to `_root` before invoking `node "$_root/.agents/..."`.
- Hook scripts also detect the repo root internally and run git/pnpm from there.
- When order matters, adapters call one orchestrator hook instead of relying on
  multiple handlers in the same lifecycle event.

## Safety Properties Of The Shell-Command Parser

`.agents/hooks/lib/shell-command.mjs` wraps `shell-quote` with extra closures
that close known bypass vectors. The dangerous-command checks rely on these:

- **Newline separator** — bash treats `\n` as a command terminator equivalent
  to `;`. `shell-quote` does not emit a separator for newlines, so the parser
  splits the input on `\n` before tokenizing each line independently.
- **Wrapper commands** — `eval "<script>"`, `bash -c "<script>"`,
  `sh -c "<script>"`, `zsh -c`, `dash -c`, `ksh -c`, `ash -c` are recursively
  re-parsed (up to four levels) so a destructive command hidden inside a
  wrapper string is still inspected.
- **Brace expansion** — positionals like `/{etc,var}` or `{/,~}` are expanded
  to all literal combinations before being matched against dangerous targets.
- **Current-directory deletes** — `rm -rf .`, `rm -rf ./`, `rm -rf *`, and
  similar broad current-directory globs are blocked because they can wipe the
  active worktree.
- **Unresolved targets** — when `rm -rf` is invoked with no positional or with
  a positional that contains command substitution (`$(…)`, backticks), a
  variable reference (`${HOME}`), or otherwise cannot be statically reduced
  to a literal path, the hook fails closed.

## Fail-Closed Orchestration

`runNodeHook` in `.agents/hooks/lib/hook-utils.mjs` maps every non-success
sub-hook outcome to exit `2` and prints the offending script and reason on
stderr. This covers:

- Spawn failures (missing/renamed sub-hook → `ENOENT`).
- Signal kills (typically hook timeout → SIGTERM).
- Unexpected exit codes (anything that is not `0` or `2`).

A broken or missing sub-hook therefore surfaces as a real block instead of a
silent pass. Each orchestrator also assigns per-phase timeouts so a stuck
phase cannot exhaust the adapter's overall timeout budget.

## Local Smoke Tests

Use these commands to check hook parsing and core branches without invoking the
full agent runtime.

```sh
printf '%s' '{"tool_input":{"command":"git status"}}' \
  | node .agents/hooks/before-bash.mjs

printf '%s' '{"tool_input":{"command":"git reset --hard"}}' \
  | node .agents/hooks/before-bash.mjs

printf '%s' '{"tool_input":{"command":"rm --recursive --force .git"}}' \
  | node .agents/hooks/before-bash.mjs

printf '%s' '{"tool_input":{"command":"rm -rf ."}}' \
  | node .agents/hooks/before-bash.mjs

printf '%s' '{"tool_input":{"command":"rm -rf *"}}' \
  | node .agents/hooks/before-bash.mjs

printf '%s' '{"tool_input":{"command":"rm -rf .[!.]*"}}' \
  | node .agents/hooks/before-bash.mjs

printf '%s' '{"tool_input":{"command":"echo \"rm -rf ~\""}}' \
  | node .agents/hooks/before-bash.mjs

# Bypass vectors closed by the parser wrapper — each should exit 2.
printf '%s' '{"tool_input":{"command":"ls\nrm -rf /"}}' \
  | node .agents/hooks/before-bash.mjs

printf '%s' '{"tool_input":{"command":"bash -c \"rm -rf /\""}}' \
  | node .agents/hooks/before-bash.mjs

printf '%s' '{"tool_input":{"command":"sudo bash -c \"rm -rf /\""}}' \
  | node .agents/hooks/before-bash.mjs

printf '%s' '{"tool_input":{"command":"bash -lc \"rm -rf /\""}}' \
  | node .agents/hooks/before-bash.mjs

printf '%s' '{"tool_input":{"command":"env FOO=1 sh -c \"git reset --hard\""}}' \
  | node .agents/hooks/before-bash.mjs

printf '%s' '{"tool_input":{"command":"/usr/bin/env rm -rf /"}}' \
  | node .agents/hooks/before-bash.mjs

printf '%s' '{"tool_input":{"command":"/usr/bin/env bash -lc \"rm -rf /\""}}' \
  | node .agents/hooks/before-bash.mjs

printf '%s' '{"tool_input":{"command":"eval \"rm -rf ~\""}}' \
  | node .agents/hooks/before-bash.mjs

printf '%s' '{"tool_input":{"command":"rm -rf {/,~}"}}' \
  | node .agents/hooks/before-bash.mjs

printf '%s' '{"tool_input":{"command":"rm -rf $(pwd)"}}' \
  | node .agents/hooks/before-bash.mjs

printf '%s' '{"tool_input":{"command":"git status"}}' \
  | node .agents/hooks/sync-before-commit.mjs

printf '%s' '{"tool_input":{"command":"git commit -m test"}}' \
  | node .agents/hooks/sync-before-commit.mjs

printf '%s' '{"tool_input":{"file_path":"scripts/validate-changed.mjs"}}' \
  | node .agents/hooks/after-edit.mjs

printf '%s' '{"tool_input":{"file_path":"workspaces/ai-engineering/llm-chat/tests/main.test.ts"}}' \
  | node .agents/hooks/test-changed.mjs

node .agents/hooks/inject-git-context.mjs

printf '%s' '{"stop_hook_active":true}' \
  | node .agents/hooks/stop-checks.mjs

printf '%s' '{"stop_hook_active":true}' \
  | node .agents/hooks/check-task-context.mjs

(cd workspaces/apps/shop-mvc-express && node ../../../.agents/hooks/inject-git-context.mjs)
```

Some smoke tests invoke `pnpm`. If sandboxed execution reports
`[ERROR] fetch failed`, rerun the same validation in an environment where the
package manager can access its cache/network.

## Explicit Validation

Broader changed-file validation is intentionally agent-callable instead of
automatic on every edit or stop:

```sh
pnpm run validate:changed
```

Claude can run this command without a permission prompt through
`.claude/settings.json`, and the portable command prompt lives at
[../commands/validate-changed.md](../commands/validate-changed.md).

## References

- Codex hooks: <https://developers.openai.com/codex/hooks>
- Claude Code hooks: <https://code.claude.com/docs/en/hooks>
