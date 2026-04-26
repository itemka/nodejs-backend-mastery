# Implement

## Purpose

Execute a focused implementation while preserving existing architecture, typing, tests, and behavior outside the task.

## When To Load

- A task has a clear goal and needs code changes.
- The implementation may cross routes, services, repositories, packages, client code, or docs.
- A plan exists and needs execution.

## Pairs With

- [implement skill](../skills/implement/SKILL.md) — canonical workflow.
- Focused skills loaded by the implement skill: [backend-api-change](../skills/backend-api-change/SKILL.md), [data-storage-change](../skills/data-storage-change/SKILL.md), [refactor](../skills/refactor/SKILL.md), [update-docs](../skills/update-docs/SKILL.md), [designing-hooks](../skills/designing-hooks/SKILL.md), [configuring-mcp](../skills/configuring-mcp/SKILL.md).
- [validate skill](../skills/validate/SKILL.md) before finishing.

## Output Contributions

- Files changed and behavior changed.
- Tests and validation run.
- Risks or follow-ups.

## Boundaries

- Do not perform unrelated refactors, formatting sweeps, or dependency upgrades.
- Do not change public contracts unless the task requires it.
- Do not run destructive commands or migrations without explicit approval.
