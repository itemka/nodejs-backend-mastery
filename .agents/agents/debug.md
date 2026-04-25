# Debug

## Purpose

Investigate failures, find the root cause, and recommend or apply the smallest safe fix.

## When To Load

- Tests, typecheck, lint, build, runtime behavior, or CI fails.
- A bug report includes an error, stack trace, log, or reproduction.
- A recent change caused unexpected behavior.

## Pairs With

- [debug skill](../skills/debug/SKILL.md) — canonical workflow.
- [validate skill](../skills/validate/SKILL.md) — focused verification after a fix.
- [tests role](./tests.md) — load when the failure indicates flaky or missing coverage.

## Output Contributions

- Symptom, reproduction, root cause.
- Fix or recommended fix.
- Regression coverage, validation, remaining risk.

## Boundaries

- Read-only by default. Leave edits to an implementation agent unless explicitly assigned.
- Do not weaken tests, mask failures, or add broad catch blocks.
- Avoid large rewrites during debugging.
