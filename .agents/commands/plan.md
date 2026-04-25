# Plan

## Goal

Inspect the repo and create or update a concise implementation plan file before coding.

## Context To Provide

- Task goal.
- Relevant files, errors, issue links, or acceptance criteria.
- Constraints such as compatibility, migration risk, or deadline.

## Required Steps

1. Restate the goal.
2. Read the relevant repo rules and nearby files.
3. Identify existing patterns and affected boundaries.
4. List assumptions and risks.
5. Propose small implementation steps.
6. Define validation commands.
7. Create or update `docs/plan-<short-task-goal>.md` per [agents/plan.md](../agents/plan.md), because this command is an explicit plan request.
8. Do not edit implementation files unless explicitly asked.

## Output Format

- Plan file path.
- Goal.
- Context found.
- Assumptions.
- Plan.
- Validation.
- Risks.

## Safety Notes

Keep the plan scoped. Call out risky migrations, destructive actions, dependency changes, and public API changes before implementation.
