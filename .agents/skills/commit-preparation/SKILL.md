---
name: commit-preparation
description: Commit preparation for current or staged diffs, Conventional Commit messages, scopes, grouping, and handoff notes. Use when asked to prepare a commit, draft a commit message, or plan logical commits.
metadata:
  created: '2026-04-25'
  status: 'baseline'
  portability: 'cross-tool'
  last-reviewed: '2026-07-03'
---

# Commit Preparation

## Purpose

Turn a current diff into logical commit guidance and handoff notes.

## When To Use

- The user asks for a commit message or commit plan.
- A diff is ready and needs grouping or validation notes.
- The user wants a final handoff after implementation.

## Inputs

- Current git diff and status.
- Tests run and results.
- Issue or task context.
- Any migration or risk notes.
- Requested scope, especially whether the user wants staged-only commit text.

## Supporting Files

- [conventional-commits](conventional-commits.md): commit type, scope, and example guidance.
- [commit-message-template](commit-message-template.md): subject and body shape for detailed commit messages.
- [pr-description skill](../pr-description/SKILL.md): PR title, summary, logical change breakdown, validation, risks, and rollback guidance.

## Related Role Specs

- [delivery](../../agents/delivery.md): load for full handoff work that includes commit grouping, PR text, validation notes, risks, rollback, and follow-ups.

## Workflow

1. Inspect git status.
2. If the user asks for staged changes, use only `git diff --cached`; otherwise compare staged and unstaged changes explicitly.
3. Group changes logically and call out unrelated groups; recommend separate commits when the diff crosses unrelated logical changes.
4. Use [conventional-commits](conventional-commits.md) for commit type, scope, subject, and breaking-change guidance.
5. Suggest one or more Conventional Commit messages.
6. Keep the commit subject as a single Conventional Commit title; when a body is useful, use [commit-message-template](commit-message-template.md).
7. Add a commit body only when it adds information the subject cannot carry; skip the body for single-purpose commits with self-explanatory subjects.
8. If the body mentions more than one important change, prefer concise one-line bullets ordered by importance or logical sequence instead of a paragraph.
9. For PR text, use [pr-description](../pr-description/SKILL.md) and [pr-readiness checklist](../../checklists/pr-readiness.md).
10. Include motivation, user-visible changes, internal changes, validation, risks, rollback, screenshots, examples, and migration notes when relevant.
11. Call out breaking changes explicitly.
12. Mention tests run, or say validation was not provided.
13. Mention risks, migrations, rollback notes, and follow-ups.
14. Do not stage, commit, open a PR, tag, or publish unless explicitly requested.
15. Never push or otherwise mutate remote state from this workflow; if the user asks to push, stop and ask them to use an explicit delivery or GitHub workflow.

## Output Format

- Suggested commit title.
- Optional commit body, using bullets when multiple important changes need mention.
- Optional commit grouping.
- Optional PR summary when part of a broader handoff.
- Validation.
- Breaking changes.
- Risks and follow-ups.

## Safety Rules

- If explicitly asked to commit, inspect the current branch first; stop and notify the user instead of committing on `main` or `master`.
- Do not include secrets or internal-only values in commit text.
- Do not claim tests passed if they were not run.
- Keep commit scope accurate and narrow.
- Do not describe unstaged or untracked files as part of a staged-only commit.
- Keep commits atomic: one logical change per commit, with the codebase left in a working state.
- Exclude noise from commit suggestions, including generated files, IDE files, commented-out code, debug statements, and sensitive data.

## When Not To Use

- No diff exists.
- The user only asks for PR text; use [pr-description](../pr-description/SKILL.md) instead.
- The user asks to implement or debug instead of prepare commit text.
