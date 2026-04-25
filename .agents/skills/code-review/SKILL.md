---
name: code-review
description: Use to review current code or a git diff for correctness, architecture, typing, tests, security, and maintainability.
metadata:
  created: '2026-04-25'
  status: 'baseline'
  portability: 'cross-tool'
  last-reviewed: '2026-04-25'
---

# Code Review

## Purpose

Review code changes and report actionable issues before merge.

## When To Use

- The user asks for review, audit, or feedback.
- A diff is ready and needs a quality pass.
- A risky change touches contracts, security, data, or shared code.

## Inputs

- Current git diff or target files.
- Related tests, docs, and contracts.
- Relevant checklists from `.agents/checklists/`.

## Workflow

1. Review correctness and user-visible behavior.
2. Review architecture boundaries and layering.
3. Review TypeScript typing, schemas, and error handling.
4. Review tests for meaningful coverage and reliability.
5. Review security risks such as validation, authz, injection, secrets, and logs.
6. Review maintainability, naming, duplication, and complexity.
7. Separate blocking issues from suggestions.
8. Provide concrete file-level feedback.

## Output Format

- Blocking issues.
- Should-fix issues.
- Suggestions.
- Test gaps.
- Open questions.

## Safety Rules

- Prioritize bugs, regressions, and security over style.
- Include file and line references when possible.
- Do not rewrite the code during a review unless explicitly asked.

## When Not To Use

- The user wants implementation, not review.
- There is no diff or file target to inspect.
