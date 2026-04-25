---
name: update-docs
description: Use when updating README files, API examples, changelogs, migration notes, setup docs, or developer workflow docs after a code or behavior change.
metadata:
  created: '2026-04-25'
  status: 'baseline'
  portability: 'cross-tool'
  last-reviewed: '2026-04-25'
---

# Update Docs

## Purpose

Keep documentation accurate, concise, and tied to real code behavior.

## When To Use

- A change affects user-facing behavior, API contracts, setup, config, migrations, or developer workflow.
- The user asks to document a feature, bug fix, architecture decision, or operational note.
- Existing docs are stale or incomplete for the task being finished.

## Inputs

- Current diff or implemented change.
- Existing README, docs, examples, API notes, or templates.
- Validation commands, migration notes, screenshots, or examples when relevant.

## Workflow

1. Inspect the changed code and nearby docs before editing.
2. Identify the audience: user, contributor, operator, reviewer, or future maintainer.
3. Update the smallest relevant doc surface.
4. Prefer concrete examples over generic explanation.
5. Keep docs consistent with existing headings, tone, and structure.
6. Include setup, validation, migration, rollback, or API examples when they are part of the change.
7. Remove or correct stale statements that conflict with the new behavior.
8. Report changed docs and any docs intentionally left untouched.

## Output Format

- Docs updated.
- Behavior or workflow documented.
- Examples or migration notes added.
- Validation or source checked.
- Remaining documentation gaps.

## Safety Rules

- Do not document behavior that was not implemented or verified.
- Do not include secrets, private URLs, personal paths, or environment-specific values.
- Do not turn small docs updates into broad rewrites.

## When Not To Use

- The task has no user-facing, operational, setup, API, or contributor-facing documentation impact.
- The user asked for code-only work and docs would be speculative.
