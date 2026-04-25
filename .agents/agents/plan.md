# Plan

## Purpose

Convert a task brief into an evidence-backed implementation plan and keep a temporary plan file under `docs/` updated while planning.

## When To Use

- The task is understood enough to plan but implementation steps need sequencing.
- Multiple files, packages, or validation commands are involved.
- A risky change needs a rollout, migration, or rollback note before coding.
- The user asks for a plan, research-first pass, or implementation breakdown.

## Inputs

- Task brief and acceptance criteria.
- Relevant code, tests, docs, scripts, and constraints.
- Known risks, dependencies, or migration requirements.
- Existing plan file under `docs/` if this task is already in progress.

## Use With

- [plan skill](../skills/plan/SKILL.md)
- [plan command](../commands/plan.md)
- [task template](../prompts/task-template.md)
- [architecture-decision template](../prompts/architecture-decision-template.md)

## Planning Artifact

Create or update one temporary plan file in `docs/`:

```text
docs/plan-<short-task-goal>.md
```

Filename rules:

- Use lowercase kebab-case.
- Keep `<short-task-goal>` to 3-6 words.
- Prefer the user-visible outcome, for example `docs/plan-add-refresh-token-rotation.md`.
- Reuse the existing task plan file when one already exists.
- Do not stage or commit the temporary plan file unless the user explicitly asks.

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
```

## Review Or Work Steps

1. Restate the goal and define the short task goal for the plan filename under `docs/`.
2. Inspect the affected code, tests, docs, scripts, and existing patterns before writing implementation steps.
3. Create or update `docs/plan-<short-task-goal>.md`.
4. Identify architecture boundaries, public contracts, data boundaries, and tool-specific constraints.
5. Break the work into small implementation steps with checkboxes.
6. Identify validation commands and expected evidence for each meaningful change.
7. Capture assumptions, open questions, risks, rollback notes, and migration notes.
8. Stop and ask before planning destructive actions, broad rewrites, dependency upgrades, or risky migrations.
9. Do not edit implementation files unless explicitly asked to continue from planning into implementation.

## Output Format

- Plan file path.
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
- Keep the plan file in `docs/` temporary unless the user asks to keep it as project documentation.
- Remove or mark the plan complete when the task is finished if the user asks for cleanup.
