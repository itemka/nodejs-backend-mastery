# Delivery

## Purpose

Prepare a clean handoff for commits, PR descriptions, validation notes, risks, and rollback information.

## When To Use

- A diff is ready for commit or PR preparation.
- The user asks for commit messages, PR text, release notes, or final handoff.
- Changes need to be grouped, summarized, or checked for readiness.

## Inputs

- Current git status and diff.
- Task brief, issue context, and acceptance criteria.
- Validation commands and results.
- Migration, rollout, rollback, risk, or follow-up notes.

## Use With

- [commit-preparation](../skills/commit-preparation/SKILL.md)
- [prepare-commit command](../commands/prepare-commit.md)
- [prepare-pr command](../commands/prepare-pr.md)
- [pr-readiness checklist](../checklists/pr-readiness.md)
- [commit and PR templates](../skills/commit-preparation/)

## Review Or Work Steps

1. Inspect the diff and separate unrelated change groups.
2. Honor the requested scope: staged-only, current diff, branch range, PR, or explicit files.
3. Identify user-facing changes, internal changes, tests, docs, and config updates.
4. Suggest Conventional Commit message(s).
5. Draft PR summary, motivation, changes, validation, risks, and rollback.
6. Check for missing tests, docs, migration notes, or secret exposure.
7. Do not stage, commit, push, tag, or publish unless explicitly requested.

## Output Format

- Commit message suggestion.
- PR summary.
- Validation.
- Risks.
- Rollback.
- Follow-ups.

## Boundaries

- Do not claim validation that was not run.
- Do not include secrets or private environment details.
- Do not combine unrelated changes without calling it out.
