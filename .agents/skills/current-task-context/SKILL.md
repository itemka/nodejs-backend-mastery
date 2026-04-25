---
name: current-task-context
description: Update docs/CURRENT_TASK_CONTEXT.md after meaningful codebase changes, debugging, reviews, or investigations. Use when preparing a handoff between AI tools, development sessions, commits, or PRs.
metadata:
  created: '2026-04-25'
  status: 'baseline'
  portability: 'cross-tool'
  last-reviewed: '2026-04-25'
---

# Current Task Context

## Purpose

Keep `docs/CURRENT_TASK_CONTEXT.md` accurate as shared working memory for humans and AI tools.

Use this skill to capture the current state of work so another tool or session can continue without losing context.

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

1. Inspect the current diff or recent changes.
2. Identify only meaningful information worth handing off.
3. Open `docs/CURRENT_TASK_CONTEXT.md`.
4. Add the newest context at the top.
5. Keep old useful context below; remove or compress stale temporary notes.
6. Record exact validation commands and real results.
7. Add a short handoff summary for the next AI or human session.
8. Report what was updated.

## Update Rules

Prefer concise entries.

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
- generic notes like “improved code”

## Recommended `docs/CURRENT_TASK_CONTEXT.md` Shape

Use this structure. Skip empty sections.

```md
# Current Task Context

Shared working context for humans and AI agents.

Newest useful context goes first.

## Current Focus

- Task:
- Goal:
- Status:
- Branch:
- Related files:

## Latest Changes

### YYYY-MM-DD — Short title

- Changed:
- Why:
- Files:
- Validation:

## Decisions

- Decision:
- Reason:
- Trade-off:

## Open Questions

- Question:
- Current assumption:

## Risks / Watchouts

- Risk:
- Mitigation:

## Next Steps

1.
2.
3.

## Validation Log

- Command:
- Result:
- Notes:

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
## Latest Changes

### 2026-04-25 — Add backend API validation

- Changed: Added request validation for the create order endpoint.
- Why: Prevent invalid payloads from reaching service logic.
- Files:
  - `workspaces/apps/orders/src/routes/orders.ts`
  - `workspaces/apps/orders/src/schemas/order.schema.ts`
  - `workspaces/apps/orders/src/routes/orders.test.ts`
- Validation:
  - `pnpm --filter orders test` — passed

## Decisions

- Decision: Keep validation at the route boundary.
- Reason: Invalid input should be rejected before business logic.
- Trade-off: Route layer has more schema code, but service layer stays cleaner.

## Risks / Watchouts

- Risk: Existing clients may rely on loose validation.
- Mitigation: Check API examples and update docs if needed.

## Next Steps

1. Review error response shape.
2. Add integration test for invalid quantity.
3. Update API docs if contract changed.

## Handoff Summary

- Current state: Validation is implemented and tested.
- What changed: Invalid order payloads now return a validation error.
- What remains: Confirm error shape matches project conventions.
- Recommended next action: Review current diff and prepare commit.
```
