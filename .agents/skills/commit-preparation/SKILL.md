---
name: commit-preparation
description: Commit and PR preparation for current or staged diffs, Conventional Commit messages, scopes, and PR-ready summaries. Use when asked to prepare a commit, draft a commit message, or summarize a diff for PR.
metadata:
  created: '2026-04-25'
  status: 'baseline'
  portability: 'cross-tool'
  last-reviewed: '2026-04-26'
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
- PR context such as target branch, screenshots, examples, rollback notes, or release constraints when preparing PR text.

## Supporting Files

- [conventional-commits](conventional-commits.md): commit type, scope, and example guidance.
- [commit-message-template](commit-message-template.md): subject and body shape for detailed commit messages.
- [pr-description-template](pr-description-template.md): PR summary, motivation, validation, risk, rollback, and checklist shape.

## Related Role Specs

- [delivery](../../agents/delivery.md): load for full handoff work that includes commit grouping, PR text, validation notes, risks, rollback, and follow-ups.

## Workflow

1. Inspect git status.
2. If the user asks for staged changes, use only `git diff --cached`; otherwise compare staged and unstaged changes explicitly.
3. Group changes logically and call out unrelated groups.
4. Use [conventional-commits](conventional-commits.md) for commit type and scope guidance.
5. Suggest one or more Conventional Commit messages.
6. Keep the commit subject as a single Conventional Commit title; when a body is useful, use [commit-message-template](commit-message-template.md).
7. If the body mentions more than one important change, prefer concise bullets under clear sections instead of a paragraph.
8. For PR text, use [pr-description-template](pr-description-template.md) and [pr-readiness checklist](../../checklists/pr-readiness.md).
9. Include motivation, user-visible changes, internal changes, validation, risks, rollback, screenshots, examples, and migration notes when relevant.
10. Call out breaking changes explicitly.
11. Mention tests run, or say validation was not provided.
12. Mention risks, migrations, rollback notes, and follow-ups.
13. Do not stage, commit, push, open a PR, tag, or publish unless explicitly requested.

## Output Format

- Suggested commit title.
- Optional commit body, using bullets when multiple important changes need mention.
- Optional commit grouping.
- PR summary.
- Validation.
- Breaking changes.
- Risks and follow-ups.

## Safety Rules

- Do not include secrets or internal-only values in commit text.
- Do not claim tests passed if they were not run.
- Keep commit scope accurate and narrow.
- Do not describe unstaged or untracked files as part of a staged-only commit.

## When Not To Use

- No diff exists.
- The user asks to implement or debug instead of prepare commit text.
