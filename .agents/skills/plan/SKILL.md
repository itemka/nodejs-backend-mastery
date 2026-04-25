---
name: plan
description: Use to turn a vague or multi-step software task into a clear implementation plan with scope, files, risks, and validation before coding. Direct invocations such as "plan this", "/plan", or "create a plan" create or update a docs/plan-*.md file.
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
- The user directly asks for a plan, planning document, `/plan`, plan skill, plan command, or plan agent.
- The user asks for a plan before implementation.
- The expected validation path is not obvious.

## Inputs

- User goal.
- Relevant constraints, files, errors, issues, or acceptance criteria.
- Current repo state and available scripts.
- Whether the request is direct planning or implicit planning before implementation.

## Workflow

1. Restate the goal in concrete terms.
2. Classify the request:
   - Direct planning: create or update `docs/plan-<short-task-goal>.md`.
   - Implicit planning: keep the plan in-chat unless [agents/plan.md](../../agents/plan.md) says a handoff file is useful.
3. Inspect relevant files before proposing changes.
4. Identify assumptions and open questions.
5. Identify risks, affected contracts, and likely test scope.
6. Propose small implementation steps.
7. Define validation commands and expected evidence.
8. Do not edit code unless the user asks for implementation.
9. For file-backed plans, follow `docs/plan-<short-task-goal>.md` naming and status guidance in [agents/plan.md](../../agents/plan.md).

## Output Format

- Plan artifact path, or reason no plan file was created.
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
- The implementation path is already obvious and low risk, and the user did not explicitly ask for planning.
- The user explicitly asked to start coding immediately.
