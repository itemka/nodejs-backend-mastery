# Review Current Diff

## Goal

Review the current git diff for bugs, regressions, security issues, test gaps, and maintainability concerns.

## Context To Provide

- Review focus, if any.
- Base branch or comparison target, if relevant.
- Known risks or areas of concern.

## Required Steps

1. Inspect git status and current diff.
2. Confirm whether the review target is unstaged, staged, last commit, or all current changes.
3. Review correctness and API/data contracts.
4. Review architecture boundaries and TypeScript typing.
5. Review tests and validation evidence.
6. Review security and sensitive-data handling.
7. Separate blocking issues from suggestions.

## Output Format

- Must fix.
- Should fix.
- Nice to have.
- Test gaps.
- Open questions.

## Safety Notes

Do not edit files during review unless explicitly asked. Do not print secrets if found.
