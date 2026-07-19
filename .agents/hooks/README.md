# Hook Map

Portable Node.js hook scripts for Codex and Claude Code live here. Keep hook
behavior in executable scripts and keep tool adapters thin.

- Codex wiring: [../../.codex/hooks.json](../../.codex/hooks.json)
- Claude wiring: [../../.claude/settings.json](../../.claude/settings.json)
- Hook design guidance:
  [../skills/designing-hooks/SKILL.md](../skills/designing-hooks/SKILL.md)

## Current Hooks

| File                          | Event                              | Blocks / Feedback                                                 | Purpose                                                                                                                                                                                         |
| ----------------------------- | ---------------------------------- | ----------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `before-bash.mjs`             | `PreToolUse` for Bash/shell        | Blocks on sub-hook failure                                        | Ordered shell-command guardrail; runs destructive-command checks before commit guardrails.                                                                                                      |
| `deny-dangerous-bash.mjs`     | `PreToolUse` via `before-bash.mjs` | Blocks with exit `2`                                              | Rejects destructive `rm -rf`, `git reset --hard`, force-push, and unparsable risky shell syntax.                                                                                                |
| `sync-before-commit.mjs`      | `PreToolUse` via `before-bash.mjs` | Blocks commit on secret/adapter failures; MCP sync is best effort | Runs deterministic pre-commit guardrails only when the command is `git commit`.                                                                                                                 |
| `after-edit.mjs`              | `PostToolUse` for edit tools       | Blocks on sub-hook failure                                        | Ordered edit guardrail; formats/lints before scoped test checks.                                                                                                                                |
| `format-and-lint.mjs`         | `PostToolUse` via `after-edit.mjs` | Blocks with exit `2` when auto-fix fails                          | Runs Prettier and ESLint fix for JS/TS edits outside ignored build folders.                                                                                                                     |
| `test-changed.mjs`            | `PostToolUse` via `after-edit.mjs` | Blocks with exit `2` on scoped test failure                       | Runs the nearest workspace `test` script when a test/spec file changes.                                                                                                                         |
| `inject-git-context.mjs`      | `UserPromptSubmit`                 | Non-blocking injected context                                     | Prints branch, dirty counts, and up to 10 short-status lines on every prompt.                                                                                                                   |
| `stop-checks.mjs`             | `Stop`                             | Blocks on sub-hook failure                                        | Ordered stop guardrail; runs scoped typecheck, then scoped tests, then the task-context reminder.                                                                                               |
| `typecheck-changed.mjs`       | `Stop` via `stop-checks.mjs`       | Blocks with exit `2` on scoped typecheck failure                  | Typechecks workspaces touched since `HEAD`, skipping recursive stop-hook runs.                                                                                                                  |
| `test-changed-workspaces.mjs` | `Stop` via `stop-checks.mjs`       | Blocks with exit `2` on scoped test failure                       | Runs `test` for every changed, test-capable workspace since `HEAD` (source/config/test files only; skips docs-only edits and packages without a `test` script); skips recursive stop-hook runs. |
| `check-task-context.mjs`      | `Stop` via `stop-checks.mjs`       | Advisory only                                                     | Reminds when `docs/CURRENT_TASK_CONTEXT.md` is missing or stale in a dirty worktree.                                                                                                            |

## Supporting Files

- `lib/hook-utils.mjs` reads hook input, detects the repo root, resolves edited
  paths inside the repo, and maps sub-hook failures to exit `2`.
- `lib/select-changed-test-workspaces.mjs` is the pure selector behind
  `test-changed-workspaces.mjs`: filters changed files to source/config/test
  extensions, then maps the survivors to test-capable workspaces via
  `scripts/lib/changed-workspaces.mjs`. Covered by
  `test-changed-workspaces.test.mjs` (`node --test`).
- `lib/shell-command.mjs` wraps `shell-quote` and provides static parsing
  helpers for newline-separated commands, wrapper commands such as
  `bash -c`/`eval`, brace expansion, and env/sudo/git prefixes.
- `deny-dangerous-bash.mjs` applies those helpers to fail closed on dangerous
  `rm -rf` targets, unresolved command substitution or variable paths, broad
  current-directory globs, hard resets, and force pushes.

## Timeout Budgets

Child hook timeouts are sized to stay under Codex's explicit outer cap
(`.codex/hooks.json`: 120s for `PostToolUse`, 180s for `Stop`):

- `after-edit.mjs`: `format-and-lint.mjs` 35s + `test-changed.mjs` 75s = 110s.
- `stop-checks.mjs`: `typecheck-changed.mjs` 85s + `test-changed-workspaces.mjs`
  70s + `check-task-context.mjs` 10s = 165s.

`.claude/settings.json` sets no `timeout` on these hooks, so Claude Code falls
back to its own default (600s for `PostToolUse`/`Stop` per its settings
schema) — comfortably above both sums, but not a cap this section reconciles
against. If Claude's default ever changes, or an explicit `timeout` is added
there, re-check these sums against it too.

When changing a child's timeout, keep the sum under the Codex outer cap and
update both the orchestrator's inline comment and this section.

## Operating Rules

- Keep shared behavior in `.agents/hooks/*.mjs`; keep `.codex/hooks.json` and
  `.claude/settings.json` as thin adapters.
- Use orchestrator hooks when order matters. Do not rely on multiple handlers
  in one lifecycle event to run sequentially.
- Keep hooks deterministic, bounded, and repo-root safe. Do not add destructive
  actions, hidden network calls, or broad writes.
- `PreToolUse` can prevent an action. `PostToolUse` runs after the action and
  can only feed back or continue the loop.
- `Stop` hooks that can block must handle `stop_hook_active` or they can loop;
  advisory-only Stop hooks (always exit `0`) are exempt.

## Local Checks

Use focused smoke tests when changing hook behavior:

```sh
printf '%s' '{"tool_input":{"command":"git status"}}' \
  | node .agents/hooks/before-bash.mjs

printf '%s' '{"tool_input":{"command":"git reset --hard"}}' \
  | node .agents/hooks/before-bash.mjs

printf '%s' '{"tool_input":{"command":"bash -c \"rm -rf /\""}}' \
  | node .agents/hooks/before-bash.mjs

printf '%s' '{"tool_input":{"command":"git commit -m test"}}' \
  | node .agents/hooks/sync-before-commit.mjs

printf '%s' '{"tool_input":{"file_path":"scripts/validate-changed.mjs"}}' \
  | node .agents/hooks/after-edit.mjs

printf '%s' '{"stop_hook_active":true}' \
  | node .agents/hooks/stop-checks.mjs

node .agents/hooks/inject-git-context.mjs

node --test .agents/hooks/test-changed-workspaces.test.mjs
```

Run the broader changed-file validation explicitly when needed (portable prompt:
[../commands/validate-changed.md](../commands/validate-changed.md)):

```sh
pnpm run validate:changed
```

If a sandboxed run reports `[ERROR] fetch failed`, rerun where pnpm can reach
its cache/network.

## References

- Codex hooks: <https://developers.openai.com/codex/hooks>
- Claude Code hooks: <https://code.claude.com/docs/en/hooks>
