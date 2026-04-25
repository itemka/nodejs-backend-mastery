# Debug

## Goal

Investigate a failing command, test, build, runtime error, or unexpected behavior and identify the minimal fix.

## Context To Provide

- Exact command or scenario that fails.
- Error output, stack trace, logs, or screenshots.
- Recent changes or suspected files.
- Environment constraints.

## Required Steps

1. Capture the exact failure.
2. Reproduce with the smallest command possible.
3. Inspect recent changes and nearby code.
4. Form 2-3 hypotheses.
5. Test hypotheses one at a time.
6. Fix the root cause with a focused diff.
7. Add a regression test when practical.
8. Run validation and report results.

## Output Format

- Reproduction.
- Root cause.
- Fix.
- Regression coverage.
- Validation.
- Remaining risk.

## Safety Notes

Do not weaken tests, suppress errors, or hide failures. Avoid broad rewrites while debugging.
