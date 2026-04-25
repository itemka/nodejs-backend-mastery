---
name: refactor
description: Use to improve internal code structure without changing external behavior, public contracts, or user-facing outputs. Triggered by "refactor", "clean up", "extract", or "simplify".
metadata:
  created: '2026-04-25'
  status: 'baseline'
  portability: 'cross-tool'
  last-reviewed: '2026-04-25'
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
- Public APIs and contracts that must be preserved.

## Workflow

1. Identify current behavior and public contracts.
2. Find existing tests or add characterization tests when useful.
3. Make small mechanical changes.
4. Preserve public APIs unless explicitly requested.
5. Avoid mixing refactor with feature work.
6. Run validation after meaningful steps.
7. Report before/after structure.

## Output Format

- Refactor goal.
- Behavior preserved.
- Files changed.
- Before/after structure.
- Validation.
- Risks.

## Safety Rules

- Do not change behavior silently.
- Do not rename exported APIs without explicit approval.
- Keep formatting-only churn out of behavior refactors.

## When Not To Use

- The user asked for a new feature or bug fix that does not need refactoring.
- Existing behavior is unknown and cannot be characterized.
