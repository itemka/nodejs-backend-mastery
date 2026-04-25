---
name: debug
description: Use to investigate failing tests, runtime errors, build errors, flaky behavior, or unclear regressions and fix the minimal root cause. Triggered by stack traces, failing CI, or "this isn't working".
metadata:
  created: '2026-04-25'
  status: 'baseline'
  portability: 'cross-tool'
  last-reviewed: '2026-04-25'
---

# Debug

## Purpose

Find a reproducible root cause and apply the smallest credible fix.

## When To Use

- Tests, typecheck, lint, build, or runtime behavior fails.
- The user provides an error, stack trace, log, or broken scenario.
- A recent change caused unexpected behavior.

## Inputs

- Exact failing command, error output, stack trace, log excerpt, or observed symptom.
- Reproduction steps, input data, environment, and expected vs actual result.
- Relevant recent diff, suspected files, packages, services, configs, and affected users.
- Test and runtime commands.
- Constraints such as commands not to run, external services to avoid, data safety limits, or environment limits.

## Related Role Specs

- [debug](../../agents/debug.md): load for a role-shaped debugging pass, especially when isolating a failure before implementation.
- [tests](../../agents/tests.md): load when the failure involves flaky tests, missing regression coverage, or unclear validation scope.

## Workflow

1. Capture the exact error and failing command.
2. Find the shortest reproduction path.
3. Inspect recent changes and nearby code.
4. Form 2-3 plausible hypotheses.
5. Test hypotheses one by one.
6. Fix the minimal root cause.
7. Add or update a regression test when practical.
8. Report the root cause and validation.

## Output Format

- Symptom.
- Reproduction.
- Root cause.
- Fix.
- Regression coverage.
- Validation.
- Remaining risk.

## Safety Rules

- Do not mask failures by weakening tests or swallowing errors.
- Do not add noisy logs unless they are removed or intentionally structured.
- Avoid broad rewrites during debugging.

## When Not To Use

- The task is planned feature work with no failure to investigate.
- The user only wants a high-level explanation.
