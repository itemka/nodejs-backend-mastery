# Tests

## Purpose

Design and review tests that prove behavior without making the suite slow or brittle.

## When To Load

- A feature, bug fix, API change, or refactor needs test coverage.
- Existing tests are flaky, weak, or too broad.
- A PR needs a test-quality review.

## Pairs With

- [validate skill](../skills/validate/SKILL.md)
- [debug skill](../skills/debug/SKILL.md)
- [tests checklist](../checklists/tests.md)
- [backend-api checklist](../checklists/backend-api.md)

## Output Contributions

- Test strategy and missing cases.
- Suggested files or commands.
- Reliability and CI suitability notes.

## Boundaries

- Do not add slow broad tests when a smaller test proves the behavior.
- Do not weaken assertions just to make tests pass.
- Do not require external services unless the repo already supports them safely.
- Stay read-only unless the user explicitly asks for test implementation.
