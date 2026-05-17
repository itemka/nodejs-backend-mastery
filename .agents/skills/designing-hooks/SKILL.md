---
name: designing-hooks
description: AI coding tool hook design and review for deterministic lifecycle automation. Use when designing, reviewing, or adapting hooks; avoid risky or destructive automation.
metadata:
  created: '2026-04-25'
  status: 'baseline'
  portability: 'cross-tool'
  last-reviewed: '2026-05-05'
---

# Designing Hooks

## Purpose

Design safe hook automation for AI coding tools while keeping shared guidance portable and avoiding premature tool-specific files.

## When To Use

- The user asks to design, review, or adapt hooks.
- A workflow needs deterministic automation before or after agent actions.
- Hook behavior affects formatting, linting, testing, approvals, notifications, or safety checks.
- Existing hook guidance or adapters need a portability or safety review.

## Inputs

- Automation goal and expected trigger.
- Target tool, if known: Codex, Claude Code, Cursor, GitHub Copilot, or another agent.
- Commands, files, or checks the hook would run.
- Expected lifecycle point and failure behavior.
- Security, performance, and developer-experience constraints.

## Related Role Specs

- [security-reviewer](../../agents/security-reviewer.md): load when hook automation can affect approvals, secrets, filesystem access, external services, or destructive commands.
- [code-review](../../agents/code-review.md): load when reviewing hook-related repo changes as part of a broader diff.

## Workflow

1. Define the automation goal in one sentence.
2. Decide whether a hook is actually needed; prefer normal docs, scripts, commands, or manual validation when deterministic lifecycle automation is not required.
3. Choose the safest lifecycle point, such as before tool use, after file edits, at session start, on prompt submit, on stop, or in the tool's equivalent hook surface.
4. Prefer fast deterministic checks: formatting changed files, linting scoped packages, typechecking scoped packages, running the smallest relevant tests, or scanning for secrets.
5. Avoid destructive commands, broad writes, force operations, hidden network calls, or automation that can mutate external systems without explicit approval.
6. Avoid external services unless the project clearly needs them and failure handling is documented.
7. Keep matchers and scope narrow so the hook runs only for the intended tools, files, or events.
8. Make hook paths and command working directories repo-root safe. Do not assume the agent session starts at the repository root; use the tool's project-dir variable, a `git rev-parse --show-toplevel` wrapper, or script-level repo-root detection.
9. Map failures to the target tool's hook semantics. Use blocking exit codes or structured JSON only where the lifecycle event can act on them; do not rely on conventional exit `1` for policy feedback.
10. Do not rely on multiple hook handlers in one lifecycle event to run sequentially. If order matters, create one small orchestrator hook that runs deterministic checks in sequence.
11. Remember lifecycle limits: `PreToolUse` can prevent an action; `PostToolUse` observes after the action happened and can only give feedback or continue the loop.
12. Prefer structured shell parsing for shell-command safety hooks. Use a maintained parser when it improves quote/operator handling; keep fail-closed behavior for unparsable risky syntax. Known parser blind spots that must be closed manually before trusting the parse: literal newline command separators, wrapper commands that take a script string (`bash -c`, `sh -c`, `zsh -c`, `eval`), brace expansion targets, and any positional that contains command substitution or variable references.
13. Make orchestrator hooks fail closed. When a sub-hook spawn fails (missing script, signal kill, timeout, unexpected exit code), surface the failure as a real block (exit `2` for Claude / Codex) instead of treating it as a silent pass. Assign per-phase timeouts so a stuck early phase cannot exhaust the adapter's overall budget.
14. Document the tool-specific adapter location only when implementation is needed; keep shared guidance in skills until concrete hook files exist.
15. Do not create scripts, settings, or hook config unless the user explicitly requests implementation.

## Output Format

- Hook goal.
- Whether a hook is needed.
- Recommended lifecycle point.
- Proposed deterministic check or action.
- Tool-specific adapter location, if implementation is requested.
- Safety risks and mitigations.
- Validation plan.

## Safety Rules

- Hooks must be safe, predictable, fast, and easy to debug.
- Do not add real hook scripts or config during design-only work.
- Do not auto-approve broad permissions or bypass safety prompts.
- Do not print secrets, tokens, private URLs, or machine-specific paths.
- Treat hook config as reviewable automation because it can affect every agent run.
- Validate hooks from both the repository root and a nested workspace directory.
- Keep hook commands deterministic and bounded with timeouts where supported.

## When Not To Use

- The task is normal implementation, debugging, docs, or validation with no hook automation.
- The user asks to add MCP servers or tool access instead of lifecycle automation.
- A one-off command is enough and does not need to run automatically.
