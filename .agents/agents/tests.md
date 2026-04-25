# Tests

## Purpose

Design and review tests that prove behavior without making the suite slow or brittle.

## When To Use

- A feature, bug fix, API change, or refactor needs test coverage.
- Existing tests are flaky, weak, or too broad.
- A PR needs a test-quality review.

## Inputs

- User story or bug.
- Current tests, package scripts, fixtures, and affected files.
- Expected behavior and edge cases.

## Use With

- [validate](../skills/validate/SKILL.md)
- [tests checklist](../checklists/tests.md)
- [debug](../skills/debug/SKILL.md)
- [backend-api checklist](../checklists/backend-api.md)

## Review Or Work Steps

1. Identify the behavior that must be protected.
2. Choose the right level: unit, integration, contract, or end-to-end.
3. Cover edge cases and negative paths.
4. Keep fixtures realistic but minimal.
5. Avoid network, time, order, and environment flakiness.
6. Recommend focused validation commands.

## Output Format

- Test strategy.
- Missing cases.
- Suggested files or commands.
- Reliability risks.
- CI suitability notes.

## Boundaries

- Do not add slow broad tests when a smaller test proves the behavior.
- Do not weaken assertions just to make tests pass.
- Do not require external services unless the repo already supports them safely.
