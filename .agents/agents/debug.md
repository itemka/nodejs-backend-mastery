# Debug

## Purpose

Investigate failures, find the root cause, and recommend or apply the smallest safe fix.

## When To Use

- Tests, typecheck, lint, build, runtime behavior, or CI fails.
- A bug report includes an error, stack trace, log, or reproduction path.
- A recent change caused unexpected behavior.

## Inputs

- Exact failing command, logs, stack trace, or observed symptom.
- Reproduction steps and expected vs actual behavior.
- Current diff, recent changes, related tests, and runtime constraints.
- Commands not to run, external services to avoid, data safety limits, and suspected files or packages when provided.

## Use With

- [debug skill](../skills/debug/SKILL.md)
- [debug command](../commands/debug.md)
- [validate](../skills/validate/SKILL.md)

## Review Or Work Steps

1. Capture the exact failure and shortest reproduction.
2. Inspect recent changes and nearby code.
3. Form a small set of plausible hypotheses.
4. Test hypotheses one at a time.
5. Isolate the root cause.
6. Apply or recommend the minimal fix.
7. Add regression coverage when practical.
8. Validate the fix with the narrowest failing command and broader checks if safe.

## Output Format

- Symptom.
- Reproduction.
- Root cause.
- Fix or recommended fix.
- Regression coverage.
- Validation.
- Remaining risk.

## Boundaries

- Do not weaken tests to make failures disappear.
- Do not hide errors with broad catch blocks or ignored promises.
- Avoid large rewrites during debugging.
