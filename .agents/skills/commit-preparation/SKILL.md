---
name: commit-preparation
description: Use to inspect the current diff and prepare clean Conventional Commit messages and PR-ready summaries.
metadata:
  created: '2026-04-25'
  status: 'baseline'
  portability: 'cross-tool'
  last-reviewed: '2026-04-25'
---

# Commit Preparation

## Purpose

Turn a current diff into logical commit guidance and PR-ready summary text.

## When To Use

- The user asks for a commit message, commit plan, or PR summary.
- A diff is ready and needs grouping or validation notes.
- The user wants a final handoff after implementation.

## Inputs

- Current git diff and status.
- Tests run and results.
- Issue or task context.
- Any migration or risk notes.

## Workflow

1. Inspect git status and diff.
2. Group changes logically.
3. Suggest one or more Conventional Commit messages.
4. Suggest a PR summary and validation section.
5. Mention tests run.
6. Mention risks, migrations, rollback notes, and follow-ups.
7. Do not commit automatically unless explicitly requested.

## Output Format

- Suggested commit message.
- Optional commit grouping.
- PR summary.
- Validation.
- Risks and follow-ups.

## Safety Rules

- Do not include secrets or internal-only values in commit text.
- Do not claim tests passed if they were not run.
- Keep commit scope accurate and narrow.

## When Not To Use

- No diff exists.
- The user asks to implement or debug instead of prepare commit text.
