---
name: current-task-context
description: Current task context handoff updates for docs/CURRENT_TASK_CONTEXT.md. Use when work will continue across turns, tools, or sessions and a compact handoff would help the next agent.
metadata:
  created: '2026-04-25'
  status: 'baseline'
  portability: 'cross-tool'
  last-reviewed: '2026-05-18'
---

# Current Task Context

## Purpose

Keep `docs/CURRENT_TASK_CONTEXT.md` as a compact local handoff so another tool or session can pick up the current work without re-deriving context from scratch.

The file is gitignored and session-only — it is shared working memory, not a permanent audit trail. Git history is the durable record; this file just carries what the next turn needs.

## When To Use

Update when work will continue across turns, tools, or sessions, after a meaningful:

- implementation, refactor, or debugging step
- review, investigation, or architecture decision
- dependency, schema, or config change
- validation run whose result informs the next action
- PR or commit preparation step

## When Not To Use

Skip the update for:

- formatting-only edits or typo fixes
- temporary experiments that were fully reverted
- information already captured in the latest entry or trivially recoverable from `git diff` / `git log`

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
2. Get a local timestamp at minute precision with timezone offset, for example `2026-05-18T16:32+02:00`.
3. Identify only meaningful information worth handing off — skip anything recoverable from git.
4. Open `docs/CURRENT_TASK_CONTEXT.md` (create it if missing).
5. Update `Current Focus`, `Open Items`, `Risks / Watchouts`, and `Handoff Summary` in place.
6. Append a typed entry to `Activity Log` if there is something worth preserving.
7. Compact `Activity Log` when it grows past ~120 lines (see Update Rules).
8. Report what was updated.

## Update Rules

`Current Focus`, `Open Items`, `Risks / Watchouts`, and `Handoff Summary` are mutable sections. Keep them current and concise — they describe the live state, not history.

`Activity Log` is append-mostly. Each entry has a typed heading with a local timestamp at minute precision and timezone offset:

```md
### 2026-05-18T16:32+02:00 - Short title (type)
```

Entry types: `implementation`, `decision`, `validation`, `review`, `blocker`, `rollback`, `handoff`, `docs`.

Compaction rule: when `Activity Log` exceeds ~120 lines, summarize or drop the oldest entries that no longer inform `Current Focus`, `Open Items`, `Risks`, or recent decisions. Do not drop entries that still load-bear for the next action. Git history remains the durable record — this file is a rolling working set, not an archive. If an old entry is wrong, append a corrected entry with a new timestamp rather than rewriting it in place.

Good context answers:

- What is the task?
- What changed and why?
- Which files matter?
- What was validated?
- What remains risky or unfinished?
- What should happen next?

Avoid:

- long terminal logs
- copied source code
- secrets
- speculation
- duplicating commit messages
- generic notes like "improved code"

## Recommended `docs/CURRENT_TASK_CONTEXT.md` Shape

Use this structure. Skip empty sections.

```md
# Current Task Context

Local working context for humans and AI agents. Session-only, gitignored.

## Current Focus

- Task:
- Status:
- Current blocker:
- Next action:
- Related files:

## Activity Log

### YYYY-MM-DDTHH:mm+HH:MM - Short title (type)

- Summary:
- Files:
- Validation:
- Follow-up:

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

For a concrete formatting example, open
[references/example.md](references/example.md) only when the template above is
not enough.
