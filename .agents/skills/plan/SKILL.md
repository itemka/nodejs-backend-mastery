---
name: plan
description: Implementation planning for vague or multi-step software tasks before coding. Use when asked to plan, /plan, or create/update a docs/plan-*.md file with scope, files, risks, steps, and validation.
metadata:
  created: '2026-04-25'
  status: 'baseline'
  portability: 'cross-tool'
  last-reviewed: '2026-07-03'
---

# Plan

## Purpose

Clarify a task, inspect the repo, and produce a small, executable implementation plan.

## When To Use

- The request is ambiguous, broad, risky, or spans multiple files.
- The user directly asks for a plan, planning document, `/plan`, plan skill, plan command, or plan agent.
- The user asks for a plan before implementation.
- The expected validation path is not obvious.

## When Not To Use

- The user asked for a simple factual answer.
- The implementation path is already obvious and low risk, and the user did not explicitly ask for planning.
- The user explicitly asked to start coding immediately.

The file-vs-chat decision itself lives in Plan Artifact Policy below.

## Inputs

- User goal, constraints, non-goals, and acceptance criteria.
- Current repo state and available scripts.
- Relevant files, errors, issues, docs, or changed behavior.
- Whether the request is direct planning or implicit planning before implementation.
- For architecture decisions: current architecture, options considered, rejected ideas, constraints, migration or rollback risks, and proof points needed.

## Related Role Specs

- [task-analyst](../../agents/task-analyst.md): load when the request is vague, broad, or missing acceptance criteria before planning.
- [plan](../../agents/plan.md): load for tool-native planner adapter behavior or role-shaped planning.
- [backend-architect](../../agents/backend-architect.md): load for backend architecture decisions, service boundaries, repository patterns, or cross-module trade-offs.

## Related Skills

- [subagent-orchestration](../subagent-orchestration/SKILL.md): use when executing a plan would benefit from independent research, disjoint implementation tracks, or implement-review loops.

## Plan Artifact Policy

Single decision home for whether to write a file and how to name it.

Create or update one temporary plan file in `docs/` when:

- The user explicitly asks for a plan, planning document, `/plan`, or the plan skill, command, or agent.
- The user asks to plan before coding or requests a written implementation breakdown.
- An existing `docs/plan-*.md` file already covers the same task.
- The task is broad, risky, long-running, cross-cutting, or likely to need handoff between sessions or tools.

Keep the plan in-chat only when:

- Planning is internal/implicit before a small implementation.
- The user asks for quick advice rather than a durable plan.
- The change is obvious, low-risk, and the user directly asked to implement.

When the user says things like "do not modify files", "do not implement", or
"produce a plan only" alongside an explicit plan request, those instructions
refer to implementation files (source, tests, configs), so they do not forbid
the plan artifact itself. The plan file _is_ the deliverable for an explicit
plan request, so still create or update `docs/plan-<short-task-goal>.md`. Only
skip the file when the user explicitly forbids creating files anywhere
(including under `docs/`); in that case, present the plan in chat and call out
that no plan file was written.

Use this path for file-backed plans:

```text
docs/plan-<short-task-goal>.md
```

Filename and timestamp rules:

- Use lowercase kebab-case.
- Keep `<short-task-goal>` to 3-6 words.
- Prefer the user-visible outcome, for example `docs/plan-add-refresh-token-rotation.md`.
- Reuse the existing task plan file when one already exists.
- Do not stage or commit the temporary plan file unless the user explicitly asks.
- Keep the plan file temporary unless the user asks to keep it as project documentation.
- Use local ISO 8601 minute precision with timezone offset for plan timestamps, for example `2026-04-25T15:36+02:00`.

## Plan File Template

The template lives in [plan-file-template.md](./plan-file-template.md). Load it
on demand when writing a file-backed plan; do not restate it here.

## Validation Policy

Every step documents how it can be validated, but execution should happen at the smallest meaningful boundary. Do not mechanically run a check after every step.

Run validation immediately after a single step when the step:

- Changes an API contract, response shape, backend mapper, or business rule.
- Touches database schema, migrations, feature-flag behavior, security-sensitive logic, or high-blast-radius code.
- Changes a shared utility used by other areas.
- Has a cheap, independent unit test that would make later work misleading if it failed.

Batch validation into the relevant area or final validation block when:

- Several tightly coupled steps only produce a meaningful result together.
- The check is slow, manual, environment-dependent, visual, or end-to-end.
- Independent `[P]` steps can be validated together.

When both lists apply, prefer the area validation block except for risk-driven changes: API contracts, mappers or business rules, schema or migration work, feature flags, security-sensitive logic, high-blast-radius code, and shared utilities. Those should validate immediately.

Run each affected validation block before PR or handoff. Stop and report the first failure instead of continuing through the plan.

## Workflow

### Creating a Plan

1. Restate the goal in concrete terms.
2. Classify the request as direct planning or implicit planning.
3. If file-backed, choose or reuse `docs/plan-<short-task-goal>.md` and capture a current local timestamp.
4. If the task covers multiple independent subsystems, suggest separate plans that can be executed and validated independently.
5. Inspect relevant code, tests, docs, scripts, and existing patterns before writing implementation steps.
6. Identify scope, non-goals, constraints, risks, affected contracts, rollback concerns, and likely test scope.
7. For architecture decisions, compare options, trade-offs, affected boundaries, implementation implications, rollback concerns, and validation proof points.
8. Break the work into small implementation steps. Each step must include an action, files, validation evidence, and done-when acceptance. Add `[P]` and `Depends on` only where useful.
9. Define validation commands and expected evidence at the step, area, or final boundary according to Validation Policy.
10. Self-review the plan: no placeholder language, no vague "handle appropriately" steps, consistent names and types, and every step actionable as written.
11. If file-backed, set `Created`, `Last updated`, and `Current step`, then pause for user review before implementation unless the user already asked to continue.

### Executing a Plan

Use this when the user asks to implement a plan or continue with the next step:

1. Read the plan and find the first unchecked step.
2. If multiple unchecked steps are independent or need review loops, use [subagent-orchestration](../subagent-orchestration/SKILL.md) to partition the work before editing.
3. Implement only the requested step or requested step range, following its files and dependencies.
4. Validate according to Validation Policy.
5. Tick completed steps and update `Status` with the next current step and `Last updated`.
6. Run every affected validation block before PR, handoff, or final response.
7. Stop and ask before destructive actions, broad rewrites, dependency upgrades, risky migrations, or scope expansion.
8. Do not edit implementation files unless the user asked to move from planning into implementation.

## Output Format

- File-backed plan: use [plan-file-template.md](./plan-file-template.md).
- In-chat plan: condense the same sections: artifact path or reason no file was created, goal, context and assumptions, steps, validation, risks, rollback notes, and trade-offs when relevant.

## Safety Rules

- Ask targeted questions only when ambiguity blocks progress or would materially change the implementation.
- Do not invent architecture that conflicts with the repo.
- Do not promise validation that cannot be run.
- Keep the plan small enough to execute incrementally.
- Keep any plan file in `docs/` temporary unless the user asks to keep it as project documentation.
- Remove or mark the plan complete when the task is finished if the user asks for cleanup.
- Do not use placeholder language in final steps: avoid `TBD`, `TODO`, "add appropriate handling", "similar to step N", or steps that describe intent without specifying action.
