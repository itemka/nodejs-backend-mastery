---
name: code-review
description: Use to review current code or a git diff for correctness, architecture, typing, security, tests, docs, maintainability, and release risk. Triggered by requests like "review this", "audit this diff", or "check for issues".
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
- Review scope: current diff, staged diff, last commit, branch range, PR, or explicit files.
- Scope or non-goals, if parts of the diff should stay out of review.
- Review focus areas such as correctness, security, API contracts, data migration, typing, tests, or frontend UX.
- Validation already run and known weak spots, shortcuts, or areas that need extra scrutiny.

## Related Role Specs

- [code-review](../../agents/code-review.md): load for a role-shaped review pass or tool-native reviewer adapter behavior.
- [security-reviewer](../../agents/security-reviewer.md): load for security-sensitive diffs or dedicated security review.
- [backend-architect](../../agents/backend-architect.md): load for backend architecture, service boundary, data flow, or cross-module design review.
- [tests](../../agents/tests.md): load when test quality, missing coverage, or flaky validation is a major review concern.

## Workflow

1. Confirm the review target and inspect `git status`.
2. Use the matching diff source, such as `git diff`, `git diff --cached`, `git show --stat --patch`, or a scoped file diff.
3. Classify touched areas and load only relevant checklists.
4. Review correctness, user-visible behavior, contracts, and regression risk first.
5. Review architecture boundaries, TypeScript typing, schemas, and error handling.
6. Review tests for meaningful coverage and reliability.
7. Review security risks such as validation, authz, injection, secrets, and logs.
8. Separate blocking findings from suggestions and open questions.
9. Provide concrete file-level feedback with line references when possible.

## Output Format

- Must-fix or blocking issues.
- Should-fix issues.
- Nice-to-have suggestions.
- Test gaps.
- Open questions.
- If no issues are found, say that directly and list residual risk or unverified checks.
- Include concrete file and line references where possible.

## Safety Rules

- Prioritize bugs, regressions, and security over style.
- Include file and line references when possible.
- Do not rewrite the code during a review unless explicitly asked.
- Do not report speculation as a finding; use open questions or test gaps for unproven risks.

## When Not To Use

- The user wants implementation, not review.
- There is no diff or file target to inspect.
