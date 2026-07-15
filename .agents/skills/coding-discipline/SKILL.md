---
name: coding-discipline
description: Guides non-trivial implementation, debugging, refactoring, code review, and multi-step engineering work through an evidence-based decision loop. Use when choices affect correctness, scope, compatibility, or risk to define a finish line, select the least-complex sound approach, constrain the diff, and verify in proportion to impact. Skip for obvious low-risk mechanical edits.
metadata:
  created: '2026-07-15'
  status: 'baseline'
  portability: 'cross-tool'
  last-reviewed: '2026-07-15'
---

# Coding Discipline

Use this workflow to make non-trivial engineering work auditable: ground decisions in repository evidence, state the intended outcome, control scope, and demonstrate completion.

Treat the always-on [project rules](../../rules/project.md) and [change discipline](../../rules/change-discipline.md) as authoritative.

Pair this cross-cutting workflow with the task-specific skill that owns the detailed procedure and output, such as [implement](../implement/SKILL.md), [debug](../debug/SKILL.md), [refactor](../refactor/SKILL.md), [code-review](../code-review/SKILL.md), or [validate](../validate/SKILL.md).

## Decision Loop

### 1. Ground The Decision

- Inspect the relevant source, tests, configuration, documentation, and current diff before deciding what to change.
- Separate confirmed facts from assumptions. Resolve uncertainty that would materially change correctness, scope, or risk; otherwise state a reasonable assumption and continue.
- Identify the existing project patterns and contracts that constrain the solution.

### 2. Define The Finish Line

- Describe the observable result that will satisfy the request.
- Record material constraints, compatibility requirements, and non-goals.
- Choose the smallest meaningful check that can demonstrate the result.

### 3. Select The Approach

- Prefer an established project pattern that meets the finish line with few moving parts.
- Compare alternatives only when their trade-offs could materially change the result.
- Do not introduce extra behavior, configuration, abstraction, or dependencies without a present requirement.

### 4. Control The Edit

- Keep edits attributable to the requested outcome.
- Exclude unrelated cleanup; report it separately when it is worth preserving for later work.
- Limit incidental cleanup to artifacts made obsolete by the current change.
- Preserve public behavior and shared contracts unless changing them is part of the request.

### 5. Demonstrate The Result

- Run the selected check first, then broaden validation according to impact and risk.
- Inspect the final diff for accidental scope growth, stale references, and unsupported claims.
- Report the commands run, their results, and anything that remains unverified.

## Boundaries

- Keep reviews and diagnosis-only requests read-only unless the user also requests implementation.
- Ask for clarification only when the missing information prevents a safe, materially correct choice.
- Stop before destructive or irreversible actions unless the user has authorized them and the consequences are understood.

## Output

Report:

- The intended outcome and material assumptions.
- The focused change or evidence-backed findings.
- The validation performed.
- Remaining risks or open questions, when applicable.
