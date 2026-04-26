---
name: refactor
description: Use to improve internal code structure without changing external behavior, public contracts, or user-facing outputs. Triggered by "refactor", "clean up", "extract", or "simplify".
metadata:
  created: '2026-04-25'
  status: 'baseline'
  portability: 'cross-tool'
  last-reviewed: '2026-04-26'
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

## Workflow

1. Identify current behavior and public contracts.
2. Find existing tests or add characterization tests when useful.
3. Confirm non-goals and behavior that must not change.
4. Make small mechanical changes.
5. Preserve public APIs unless explicitly requested.
6. Avoid mixing refactor with feature work.
7. Run validation after meaningful steps.
8. Report before/after structure and behavior-preservation evidence.

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
