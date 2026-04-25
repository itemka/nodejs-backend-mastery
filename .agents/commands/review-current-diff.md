# Review Current Diff

## Goal

Review the current git diff for bugs, regressions, security issues, test gaps, and maintainability concerns.

## Context To Provide

- Review focus, if any.
- Base branch or comparison target, if relevant.
- Known risks or areas of concern.

## Required Steps

1. Inspect git status and current diff.
2. Review correctness and API/data contracts.
3. Review architecture boundaries and TypeScript typing.
4. Review tests and validation evidence.
5. Review security and sensitive-data handling.
6. Separate blocking issues from suggestions.

## Output Format

- Must fix.
- Should fix.
- Nice to have.
- Test gaps.
- Open questions.

## Safety Notes

Do not edit files during review unless explicitly asked. Do not print secrets if found.
