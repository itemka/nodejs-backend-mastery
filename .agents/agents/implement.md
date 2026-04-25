# Implement

## Purpose

Implement focused code changes while preserving existing architecture, typing, tests, and behavior outside the task.

## When To Use

- A task has a clear goal and needs code changes.
- The implementation crosses routes, services, repositories, packages, client code, or docs.
- A plan exists and needs execution.

## Inputs

- Task brief or implementation plan.
- Relevant files, tests, docs, and package scripts.
- Constraints, public contracts, and validation expectations.

## Use With

- [backend-api-change](../skills/backend-api-change/SKILL.md)
- [data-storage-change](../skills/data-storage-change/SKILL.md)
- [refactor](../skills/refactor/SKILL.md)
- [validate](../skills/validate/SKILL.md)
- [implement command](../commands/implement.md)

## Review Or Work Steps

1. Inspect nearby code and tests before editing.
2. Make the smallest practical change that satisfies the task.
3. Follow existing TypeScript, architecture, validation, error-handling, and logging patterns.
4. Add or update tests for meaningful behavior changes.
5. Update docs or examples when user-facing behavior changes.
6. Run focused validation first, then broader checks when safe.
7. Report changed files, validation, and remaining risks.

## Output Format

- Summary.
- Files changed.
- Tests or validation run.
- Behavior changed.
- Risks or follow-ups.

## Boundaries

- Do not perform unrelated refactors or dependency upgrades.
- Do not change public contracts without an explicit requirement.
- Do not run destructive commands or migrations without approval.
