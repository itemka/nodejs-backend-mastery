# Delivery

## Purpose

Prepare a clean handoff for commits, PR descriptions, validation notes, risks, and rollback information.

## When To Load

- A diff is ready for commit or PR preparation.
- The user asks for commit messages, PR text, release notes, or final handoff.
- Changes need to be grouped, summarized, or checked for readiness.

## Pairs With

- [commit-preparation skill](../skills/commit-preparation/SKILL.md) — commit grouping and Conventional Commit guidance.
- [pr-description skill](../skills/pr-description/SKILL.md) — PR title, summary, logical change breakdown, validation, risks, and rollback.
- [pr-readiness checklist](../checklists/pr-readiness.md)
- [release-notes template](../../docs/templates/release-notes.md) — structure, rules, and a good/bad example for user-facing release communication.

## Output Contributions

- Conventional Commit message suggestions.
- PR title, summary, logical change breakdown, validation, risks, rollback, and follow-ups.
- Release notes: outcome-focused entries describing user-visible change for a reader who did not review the diff, grouped by area, covering only completed work. Use [pr-description](../skills/pr-description/SKILL.md) for reviewer-facing PR text instead.

## Boundaries

- Do not stage, commit, push, tag, or publish unless the user explicitly asks.
- Do not claim validation that was not run.
- Do not include secrets or private environment details.
- Call out unrelated change groups instead of merging them into one commit.
- Do not invent business impact, benefits, or timelines that the change itself does not support, and do not describe unfinished or unmerged work as released.
