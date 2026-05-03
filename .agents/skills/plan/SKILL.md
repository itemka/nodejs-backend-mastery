---
name: plan
description: Use to turn a vague or multi-step software task into a clear implementation plan with scope, files, risks, and validation before coding. Direct invocations such as "plan this", "/plan", or "create a plan" create or update a docs/plan-*.md file.
metadata:
  created: '2026-04-25'
  status: 'baseline'
  portability: 'cross-tool'
  last-reviewed: '2026-04-26'
---

# Plan

## Purpose

Clarify a task, inspect the repo, and produce a small implementation plan.

## When To Use

- The request is ambiguous, broad, risky, or spans multiple files.
- The user directly asks for a plan, planning document, `/plan`, plan skill, plan command, or plan agent.
- The user asks for a plan before implementation.
- The expected validation path is not obvious.

## Inputs

- User goal.
- Relevant constraints, non-goals, files, errors, issues, or acceptance criteria.
- Current repo state and available scripts.
- Whether the request is direct planning or implicit planning before implementation.
- Architecture decision context when relevant: current architecture, options considered, rejected ideas, constraints, migration or rollback risks, and proof points needed.

## Related Role Specs

- [task-analyst](../../agents/task-analyst.md): load when the request is vague, broad, or missing acceptance criteria before planning.
- [plan](../../agents/plan.md): load for tool-native planner adapter behavior or role-shaped planning.
- [backend-architect](../../agents/backend-architect.md): load for backend architecture decisions, service boundaries, repository patterns, or cross-module trade-offs.

## Plan Artifact Policy

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
refer to implementation files (source, tests, configs) — they do not forbid
the plan artifact itself. The plan file _is_ the deliverable for an explicit
plan request, so still create or update `docs/plan-<short-task-goal>.md`. Only
skip the file when the user explicitly forbids creating files anywhere
(including under `docs/`); in that case, present the plan in chat and call out
that no plan file was written.

Use this path for file-backed plans:

```text
docs/plan-<short-task-goal>.md
```

Filename rules:

- Use lowercase kebab-case.
- Keep `<short-task-goal>` to 3-6 words.
- Prefer the user-visible outcome, for example `docs/plan-add-refresh-token-rotation.md`.
- Reuse the existing task plan file when one already exists.
- Do not stage or commit the temporary plan file unless the user explicitly asks.
- Use local ISO 8601 minute precision with timezone offset for plan timestamps, for example `2026-04-25T15:36+02:00`.

## Plan File Template

```md
# Plan: <short task goal>

## Goal

## Context Checked

## Assumptions

## Open Questions

## Risks

## Affected Areas

## Implementation Steps

- [ ] Step 1

## Validation

## Rollback Or Migration Notes

## Status

- State: draft
- Created: YYYY-MM-DDTHH:mm+HH:MM
- Last updated: YYYY-MM-DDTHH:mm+HH:MM
```

## Workflow

1. Restate the goal in concrete terms.
2. Classify the request as direct planning or implicit planning.
3. If file-backed, choose or reuse `docs/plan-<short-task-goal>.md` and capture a current local timestamp.
4. Inspect relevant code, tests, docs, scripts, and existing patterns before writing implementation steps.
5. Identify non-goals, constraints, risks, affected contracts, and likely test scope.
6. For architecture decisions, compare options, trade-offs, affected boundaries, implementation implications, rollback concerns, and validation proof points.
7. Break the work into small implementation steps with checkboxes.
8. Define validation commands and expected evidence for each meaningful change.
9. Capture assumptions, open questions, risks, rollback notes, and migration notes.
10. Stop and ask before planning destructive actions, broad rewrites, dependency upgrades, or risky migrations.
11. Do not edit implementation files unless explicitly asked to continue from planning into implementation.

## Output Format

- Plan artifact path, or reason no plan file was created.
- Goal.
- Relevant context found.
- Assumptions or questions.
- Plan.
- Validation.
- Risks.
- Trade-offs or decision rationale when relevant.

## Safety Rules

- Do not invent architecture that conflicts with the repo.
- Do not promise validation that cannot be run.
- Keep the plan small enough to execute incrementally.
- Keep any plan file in `docs/` temporary unless the user asks to keep it as project documentation.
- Remove or mark the plan complete when the task is finished if the user asks for cleanup.

## When Not To Use

- The user asked for a simple factual answer.
- The implementation path is already obvious and low risk, and the user did not explicitly ask for planning.
- The user explicitly asked to start coding immediately.
