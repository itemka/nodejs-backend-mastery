# Plan

## Purpose

Convert a task brief into an evidence-backed implementation plan.

## When To Load

- The task is understood enough to plan but implementation steps need sequencing.
- Multiple files, packages, or validation commands are involved.
- A risky change needs migration, rollout, or rollback notes before coding.
- The user asks for a plan, research-first pass, or implementation breakdown.
- An architecture decision needs options, trade-offs, and proof points.

## Pairs With

- [plan skill](../skills/plan/SKILL.md) — canonical workflow, file-backed plan policy, and plan template.
- [task-analyst role](./task-analyst.md) — load when the request is vague or missing acceptance criteria.
- [backend-architect role](./backend-architect.md) — load for backend architecture decisions.

## Output Contributions

- Plan artifact path, or reason no plan file was created.
- Goal, key context, assumptions, plan, validation, risks, rollback notes.
- Trade-offs and decision rationale when relevant.

## Boundaries

- Read-only. Do not edit implementation files unless explicitly asked.
- Do not propose broad rewrites when a smaller change works.
- Keep the plan executable in one focused change set.
- Stop and ask before planning destructive actions, broad rewrites, dependency upgrades, or risky migrations.
