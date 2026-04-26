---
name: implement
description: Use to implement focused code, documentation, or configuration changes while preserving existing architecture, contracts, tests, and validation discipline.
metadata:
  created: '2026-04-25'
  status: 'baseline'
  portability: 'cross-tool'
  last-reviewed: '2026-04-26'
---

# Implement

## Purpose

Implement requested changes with the smallest practical diff while preserving existing behavior outside the task.

## When To Use

- The user asks to add, change, or fix code, docs, tests, config, or automation.
- A plan exists and needs execution.
- The work may cross routes, services, repositories, packages, client code, docs, or tool adapters.

## Inputs

- Task brief, plan, or acceptance criteria.
- Relevant files, tests, docs, and package scripts.
- Constraints, non-goals, public contracts, and validation expectations.
- Commands that should or should not be run.
- Risks such as migrations, public API changes, data loss, performance, security, or unknowns.
- Expected final response shape, if the user asks for specific reporting.

## Related Role Specs

- [implement](../../agents/implement.md): load for role-shaped implementation support or tool-native worker adapter behavior.
- [backend-architect](../../agents/backend-architect.md): load before coding when backend boundaries, data flow, or architecture trade-offs are unclear.
- [tests](../../agents/tests.md): load when test design or validation scope is a meaningful part of the implementation.

## Workflow

1. Read the repo rules and inspect nearby code, tests, docs, scripts, and existing patterns before editing.
2. Classify the task and load focused skills when relevant:
   - Backend API behavior: [backend-api-change](../backend-api-change/SKILL.md)
   - Data, persistence, migrations, queries, or caching: [data-storage-change](../data-storage-change/SKILL.md)
   - Internal cleanup with preserved behavior: [refactor](../refactor/SKILL.md)
   - Documentation impact: [update-docs](../update-docs/SKILL.md)
   - Hook design: [designing-hooks](../designing-hooks/SKILL.md)
   - MCP configuration boundaries: [configuring-mcp](../configuring-mcp/SKILL.md)
3. Make the smallest practical change that satisfies the task.
4. Follow existing architecture, naming, TypeScript, validation, error-handling, and logging patterns.
5. Preserve stated non-goals, acceptance criteria, public contracts, and compatibility constraints.
6. Add or update tests for meaningful behavior changes.
7. Update docs or examples when user-facing, setup, API, migration, or workflow behavior changes.
8. Use [validate](../validate/SKILL.md) before finishing.
9. Use [current-task-context](../current-task-context/SKILL.md) after meaningful implementation handoffs.

## Output Format

- Summary.
- Files changed.
- Behavior changed.
- Tests and validation.
- Assumptions or open questions, when relevant.
- Risks or follow-ups.

## Safety Rules

- Do not perform unrelated refactors, formatting sweeps, dependency upgrades, destructive commands, or broad rewrites without explicit approval.
- Do not change public contracts unless the task requires it.
- Do not hide validation failures or claim checks passed when they were not run.
- Do not add secrets, local machine paths, private URLs, or personal environment details.

## When Not To Use

- The user only wants a read-only review, plan, explanation, or commit message.
- The request is too ambiguous to implement safely before planning.
- The task requires external writes, deployment, production data access, or destructive operations without explicit approval.
