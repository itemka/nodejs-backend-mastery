# Plan

## Purpose

Convert a task brief into an evidence-backed implementation plan. Direct plan requests create or update a temporary plan file under `docs/`; implicit planning can stay in-chat unless a file is useful for handoff.

## When To Use

- The task is understood enough to plan but implementation steps need sequencing.
- Multiple files, packages, or validation commands are involved.
- A risky change needs a rollout, migration, or rollback note before coding.
- The user asks for a plan, research-first pass, or implementation breakdown.

## Inputs

- Task brief and acceptance criteria.
- Relevant code, tests, docs, scripts, and constraints.
- Known risks, dependencies, or migration requirements.
- Existing plan file under `docs/` if this task is already in progress or the request should be file-backed.
- Architecture decision inputs when relevant: current architecture, business need, non-goals, options considered, rejected ideas, constraints, affected files, validation proof points, and rollback concerns.

## Use With

- [plan skill](../skills/plan/SKILL.md)
- [plan command](../commands/plan.md)

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

Use this structure:

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

## Review Or Work Steps

1. Restate the goal and classify the request as direct planning or implicit planning.
2. If the plan is file-backed, choose or reuse `docs/plan-<short-task-goal>.md` and get a current local timestamp.
3. Inspect the affected code, tests, docs, scripts, and existing patterns before writing implementation steps.
4. Create or update the plan file when the policy above requires it; otherwise state why no plan file was created.
5. Identify architecture boundaries, public contracts, data boundaries, and tool-specific constraints.
6. For architecture decisions, compare options with rationale, trade-offs, implementation implications, validation proof points, and rollback notes.
7. Break the work into small implementation steps with checkboxes.
8. Identify validation commands and expected evidence for each meaningful change.
9. Capture assumptions, open questions, risks, rollback notes, and migration notes.
10. Stop and ask before planning destructive actions, broad rewrites, dependency upgrades, or risky migrations.
11. Do not edit implementation files unless explicitly asked to continue from planning into implementation.

## Output Format

- Plan artifact: `docs/plan-<short-task-goal>.md`, or `Not created: <reason>`.
- Goal.
- Key context checked.
- Implementation steps summary.
- Validation summary.
- Open questions or blockers.
- Risks and rollback or migration notes.

## Boundaries

- Do not edit implementation files unless explicitly asked.
- Do not propose broad rewrites when a smaller change works.
- Keep the plan executable in one focused change set.
- Keep any plan file in `docs/` temporary unless the user asks to keep it as project documentation.
- Remove or mark the plan complete when the task is finished if the user asks for cleanup.
