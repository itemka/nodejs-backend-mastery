# Code Review Checklist

Use for diff-focused reviews. Lead with blocking issues and keep suggestions small.

## Correctness

- Does the change satisfy the requested behavior?
- Are edge cases, empty states, and failure paths handled?
- Are public contracts and response shapes preserved unless intentionally changed?

## Architecture

- Does the code follow existing layering and module boundaries?
- Are route handlers thin where the repo expects service or repository layers?
- Is new abstraction justified by real duplication or complexity?

## Typing

- Are TypeScript types precise and narrow?
- Are schemas used at external boundaries?
- Is `any` avoided or clearly contained?

## Errors

- Are typed errors mapped to correct outcomes?
- Are internal errors hidden from clients?
- Are logs useful without exposing secrets or sensitive data?

## Tests

- Are meaningful unit, integration, or contract tests updated?
- Are negative paths covered?
- Are tests deterministic and suitable for CI?

## Readability

- Are names clear and consistent with nearby code?
- Is the diff minimal and focused?
- Is duplicated or complex logic justified?

## Performance

- Are hot paths, N+1 queries, large payloads, and unnecessary renders avoided?
- Are timeouts, pagination, caching, or batching considered where relevant?

## Docs

- Are README, API examples, migration notes, or comments updated when behavior changes?
