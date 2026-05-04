---
name: validate
description: Validation workflow for tests, typechecks, linting, formatting, builds, and focused verification. Use before finishing changes or when asked to validate, run tests, or check work.
metadata:
  created: '2026-04-25'
  status: 'baseline'
  portability: 'cross-tool'
  last-reviewed: '2026-04-26'
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

## Related Role Specs

- [tests](../../agents/tests.md): load when choosing test level, reviewing missing cases, or diagnosing flaky or brittle validation.

## Workflow

1. Inspect package scripts and affected workspace boundaries.
2. Map changed files to the smallest meaningful checks before running broad commands.
3. Run the smallest relevant test, parser, or typecheck first.
4. Run lint, format check, build, and broader tests when available and safe.
5. Capture exact commands and high-level results.
6. If a command cannot run, explain why and what remains unverified.
7. Do not hide failures. Report the first actionable failure with context.

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
