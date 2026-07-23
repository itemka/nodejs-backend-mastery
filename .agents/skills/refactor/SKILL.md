---
name: refactor
description: Refactoring workflow for improving internal code structure without changing external behavior, public contracts, or user-facing outputs. Use when asked to refactor, clean up, extract, or simplify.
metadata:
  created: '2026-04-25'
  status: 'baseline'
  portability: 'cross-tool'
  last-reviewed: '2026-07-22'
---

# Refactor

## Purpose

Improve structure while preserving behavior.

## When To Use

- The user asks for cleanup, simplification, extraction, or reorganization.
- Internal code structure is making a change harder.
- Duplication or coupling has a clear local cost.

## Inputs

- Target files or module.
- Current tests or behavior examples.
- Behavior to preserve, including public APIs, response shapes, tests, fixtures, and user-visible behavior.
- Constraints such as module boundaries, dependency limits, compatibility requirements, timeline, or rollout concerns.
- Known weak tests, shared modules, or regression-prone paths.

## Related Role Specs

- [backend-architect](../../agents/backend-architect.md): load for boundary-level refactors, service/repository restructuring, or architectural trade-offs.
- [tests](../../agents/tests.md): load when behavior-preservation evidence or characterization coverage is unclear.

## Related Workflows

- [plan](../plan/SKILL.md): use when the decomposition is large enough to need a written plan file rather than an inline proposal.

## Workflow

1. Identify current behavior and public contracts.
2. Find existing tests or add characterization tests when useful.
3. Confirm non-goals and behavior that must not change.
4. For a structural smell — a function or class with accumulated responsibilities, behavior sitting away from its data, or a change that would ripple across unrelated files — state the target decomposition first: responsibilities to extract, modules or methods to create, dependencies to move, and what stays. Get agreement before editing only when the decomposition materially expands scope, changes public contracts, or leaves an ambiguity that prevents a safe choice. Small local extractions do not need this.
5. Make small mechanical changes.
6. Preserve public APIs unless explicitly requested.
7. Avoid mixing refactor with feature work.
8. Run validation after meaningful steps.
9. Report before/after structure and behavior-preservation evidence.

## Output Format

- Refactor goal.
- Behavior preserved.
- Files changed.
- Before/after structure.
- Validation.
- Behavior-preservation evidence.
- Risks.

## Safety Rules

- Do not change behavior silently.
- Do not rename exported APIs without explicit approval.
- Keep formatting-only churn out of behavior refactors.

## When Not To Use

- The user asked for a new feature or bug fix that does not need refactoring.
- Existing behavior is unknown and cannot be characterized.
