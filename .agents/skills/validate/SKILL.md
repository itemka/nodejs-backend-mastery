---
name: validate
description: Use before finishing work to choose and run relevant tests, typechecks, linting, formatting, builds, or focused verification commands. Triggered by "validate", "run the tests", "check this works", or finalizing a change.
metadata:
  created: '2026-04-25'
  status: 'baseline'
  portability: 'cross-tool'
  last-reviewed: '2026-04-25'
---

# Validate

## Purpose

Validate changes with the smallest useful checks first, then broader checks when safe.

## When To Use

- Before finalizing code changes.
- After fixing a bug, adding behavior, or changing config.
- When a user asks what validation was run.

## Inputs

- Current diff.
- Package scripts.
- Changed files and affected workspaces.
- Known failing commands or environmental limits.

## Workflow

1. Inspect package scripts and affected workspace boundaries.
2. Run the smallest relevant test or typecheck first.
3. Run lint, format check, build, and broader tests when available and safe.
4. Capture exact commands and high-level results.
5. If a command cannot run, explain why and what remains unverified.
6. Do not hide failures. Report the first actionable failure with context.

## Output Format

- Commands run.
- Result for each command.
- Failures and suspected cause, if any.
- Unverified areas.

## Safety Rules

- Do not run commands that are destructive or require external services without checking.
- Do not use broad install or upgrade commands just to run validation.
- Prefer filtered workspace checks when the diff is narrow.

## When Not To Use

- No files were changed and the user only asked for analysis.
- The relevant validation would require unsafe external side effects.
