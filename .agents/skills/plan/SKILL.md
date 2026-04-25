---
name: plan
description: Use to turn a vague or multi-step software task into a clear implementation plan before coding.
metadata:
  created: '2026-04-25'
  status: 'baseline'
  portability: 'cross-tool'
  last-reviewed: '2026-04-25'
---

# Plan

## Purpose

Clarify a task, inspect the repo, and produce a small implementation plan.

## When To Use

- The request is ambiguous, broad, risky, or spans multiple files.
- The user asks for a plan before implementation.
- The expected validation path is not obvious.

## Inputs

- User goal.
- Relevant constraints, files, errors, issues, or acceptance criteria.
- Current repo state and available scripts.

## Workflow

1. Restate the goal in concrete terms.
2. Inspect relevant files before proposing changes.
3. Identify assumptions and open questions.
4. Identify risks, affected contracts, and likely test scope.
5. Propose small implementation steps.
6. Define validation commands and expected evidence.
7. Do not edit code unless the user asks for implementation.
8. If you save the plan as a file, use `docs/plan-<short-task-goal>.md` per [agents/plan.md](../../agents/plan.md).

## Output Format

- Goal.
- Relevant context found.
- Assumptions or questions.
- Plan.
- Validation.
- Risks.

## Safety Rules

- Do not invent architecture that conflicts with the repo.
- Do not promise validation that cannot be run.
- Keep the plan small enough to execute incrementally.

## When Not To Use

- The user asked for a simple factual answer.
- The implementation path is already obvious and low risk.
- The user explicitly asked to start coding immediately.
