---
name: current-task-context
description: Update docs/CURRENT_TASK_CONTEXT.md after meaningful codebase changes, debugging, reviews, investigations, or handoffs between AI tools, development sessions, commits, or PRs.
metadata:
  created: '2026-04-25'
  status: 'baseline'
  portability: 'cross-tool'
  last-reviewed: '2026-04-25'
---

# Current Task Context

## Purpose

Keep `docs/CURRENT_TASK_CONTEXT.md` accurate as shared working memory and an audit trail for humans and AI tools.

Use this skill to capture the current state of work so another tool or session can continue without losing context, while preserving the history of meaningful implementation, decision, validation, and handoff events.

## When To Use

Use after a meaningful:

- implementation
- refactor
- debugging session
- code review
- test fix
- architecture decision
- dependency or config change
- investigation that changes understanding of the codebase
- PR or commit preparation step

## When Not To Use

Do not update for:

- formatting-only edits
- typo-only changes
- temporary experiments that were fully reverted
- duplicated information already captured in the latest entry

## Inputs

Collect the facts before editing the context file:

- current goal or task
- current git diff or changed files
- important decisions
- validation commands and results
- unresolved risks or open questions
- recommended next step

Do not guess missing facts. Mark unknowns clearly.

## Workflow

1. Inspect the current diff, recent changes, and `git status`.
2. Get a local timestamp at minute precision with timezone offset, for example `2026-04-25T14:32+02:00`.
3. Identify only meaningful information worth handing off or preserving.
4. Open `docs/CURRENT_TASK_CONTEXT.md`.
5. Update `Current Focus` in place with the latest live state.
6. Append new entries to `Implementation Log`, `Decision Log`, and `Validation Log` as needed.
7. Record exact validation commands and real results.
8. Update `Open Items` and `Handoff Summary` so the next AI or human session can continue.
9. Report what was updated.

## Update Rules

Prefer concise entries, but do not collapse history into a single latest summary.

`Current Focus`, `Open Items`, and `Handoff Summary` are mutable sections. Keep them current and concise.

`Implementation Log`, `Decision Log`, and `Validation Log` are append-only sections. Do not delete, reorder, or rewrite historical entries just because newer work supersedes them. If an old entry is wrong, append a correction entry with a new timestamp. Archive old history only when explicitly asked.

Use local ISO 8601 minute precision with timezone offset for log headings:

```md
### 2026-04-25T14:32+02:00 - Short title
```

Seconds are unnecessary for manual updates. Automated tooling may include seconds if needed for uniqueness.

Meaningful event types include:

- implementation
- review
- validation
- decision
- blocker
- rollback
- handoff
- docs update

Good context answers these questions:

- What is the task?
- What changed?
- Why did it change?
- Which files matter?
- What was validated?
- What remains risky or unfinished?
- What should happen next?

Avoid:

- long logs
- copied source code
- secrets
- speculation
- duplicate commit messages
- generic notes like "improved code"

## Recommended `docs/CURRENT_TASK_CONTEXT.md` Shape

Use this structure. Skip empty sections.

```md
# Current Task Context

Shared working context for humans and AI agents.

Current focus is the live handoff. Logs are historical and append-only.

## Current Focus

- Task:
- Status:
- Current blocker:
- Next action:
- Related files:

## Implementation Log

### YYYY-MM-DDTHH:mm+HH:MM - Short title

- Type:
- Status:
- Actor:
- Implemented:
- Files:
- Validation:
- Follow-up:

## Decision Log

### YYYY-MM-DDTHH:mm+HH:MM - Short title

- Decision:
- Reason:
- Trade-off:

## Validation Log

### YYYY-MM-DDTHH:mm+HH:MM - Short title

- Commands:
- Result:
- Notes:

## Open Items

- [ ] Item:

## Risks / Watchouts

- Risk:
- Mitigation:

## Handoff Summary

- Current state:
- What changed:
- What remains:
- Recommended next action:
```

## Safety Rules

- Never include secrets, tokens, passwords, API keys, private URLs, or personal data.
- Never invent validation results.
- Never paste full source files.
- Never paste long terminal logs.
- Use file paths and short summaries instead of large code snippets.
- Mark unknowns as `Unknown`, `Not checked`, or `Not validated`.
- If validation was not run, say why.

## Output Format

After updating the file, respond with:

```md
Updated `docs/CURRENT_TASK_CONTEXT.md`.
```

## Example Entry

```md
## Current Focus

- Task: Add backend API validation.
- Status: Validation implemented and tested.
- Current blocker: None.
- Next action: Review error response shape.
- Related files:
  - `workspaces/apps/orders/src/routes/orders.ts`
  - `workspaces/apps/orders/src/schemas/order.schema.ts`
  - `workspaces/apps/orders/src/routes/orders.test.ts`

## Implementation Log

### 2026-04-25T14:32+02:00 - Add backend API validation

- Type: implementation
- Status: done
- Actor: Codex
- Implemented: Added request validation for the create order endpoint to prevent invalid payloads from reaching service logic.
- Files:
  - `workspaces/apps/orders/src/routes/orders.ts`
  - `workspaces/apps/orders/src/schemas/order.schema.ts`
  - `workspaces/apps/orders/src/routes/orders.test.ts`
- Validation:
  - `pnpm --filter orders test` - passed
- Follow-up: Confirm error response shape matches project conventions.

## Decision Log

### 2026-04-25T14:32+02:00 - Keep validation at the route boundary

- Decision: Keep validation at the route boundary.
- Reason: Invalid input should be rejected before business logic.
- Trade-off: Route layer has more schema code, but service layer stays cleaner.

## Validation Log

### 2026-04-25T14:32+02:00 - Validate order route changes

- Commands:
  - `pnpm --filter orders test`
- Result: Passed.
- Notes: Covered invalid quantity.

## Risks / Watchouts

- Risk: Existing clients may rely on loose validation.
- Mitigation: Check API examples and update docs if needed.

## Open Items

- [ ] Update API docs if contract changed.

## Handoff Summary

- Current state: Validation is implemented and tested.
- What changed: Invalid order payloads now return a validation error.
- What remains: Confirm error shape matches project conventions.
- Recommended next action: Review current diff and prepare commit.
```
