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

- [implement](../skills/implement/SKILL.md)
- [backend-api-change](../skills/backend-api-change/SKILL.md)
- [data-storage-change](../skills/data-storage-change/SKILL.md)
- [refactor](../skills/refactor/SKILL.md)
- [validate](../skills/validate/SKILL.md)
- [implement command](../commands/implement.md)

## Review Or Work Steps

1. Follow the [implement skill](../skills/implement/SKILL.md) as the canonical workflow.
2. Load focused skills for backend API, data storage, refactor, docs, hook, or MCP work when the task touches those surfaces.
3. Report changed files, validation, behavior changes, and remaining risks.

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
