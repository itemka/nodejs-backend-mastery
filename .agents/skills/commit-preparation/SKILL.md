---
name: commit-preparation
description: Use to inspect the current diff and prepare clean Conventional Commit messages, scopes, and PR-ready change summaries. Triggered by requests like "prepare a commit message", "draft a commit", or "summarize this diff for a PR".
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
- Requested scope, especially whether the user wants staged-only commit text.

## Workflow

1. Inspect git status.
2. If the user asks for staged changes, use only `git diff --cached`; otherwise compare staged and unstaged changes explicitly.
3. Group changes logically and call out unrelated groups.
4. Suggest one or more Conventional Commit messages.
5. Suggest a PR summary and validation section when useful.
6. Mention tests run, or say validation was not provided.
7. Mention risks, migrations, rollback notes, and follow-ups.
8. Do not stage, commit, or push unless explicitly requested.

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
- Do not describe unstaged or untracked files as part of a staged-only commit.

## When Not To Use

- No diff exists.
- The user asks to implement or debug instead of prepare commit text.
