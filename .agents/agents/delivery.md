# Delivery

## Purpose

Prepare a clean handoff for commits, PR descriptions, validation notes, risks, and rollback information.

## When To Load

- A diff is ready for commit or PR preparation.
- The user asks for commit messages, PR text, release notes, or final handoff.
- Changes need to be grouped, summarized, or checked for readiness.

## Pairs With

- [commit-preparation skill](../skills/commit-preparation/SKILL.md) — canonical workflow and templates.
- [pr-readiness checklist](../checklists/pr-readiness.md)

## Output Contributions

- Conventional Commit message suggestions.
- PR summary, motivation, validation, risks, rollback, follow-ups.

## Boundaries

- Do not stage, commit, push, tag, or publish unless the user explicitly asks.
- Do not claim validation that was not run.
- Do not include secrets or private environment details.
- Call out unrelated change groups instead of merging them into one commit.
