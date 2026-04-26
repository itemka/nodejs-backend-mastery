# Unit testing (Vitest / Jest)

**Category:** testing-quality · **Primary app:** all · **Prereqs:** — · **Status:** todo

## Scope
- Vitest (already in local-llm-playground) for fast ESM-native testing.
- Arrange-Act-Assert structure; one behavior per test.
- Mocking only external dependencies at the seam (repositories, HTTP clients).
- Snapshot testing — use sparingly.

## Sub-tasks
- [ ] Add Vitest unit tests for each service in shop-feature-fastify; mock only repositories.
- [ ] Target 80%+ coverage for services; don't chase 100%.
- [ ] Write a note on what *not* to unit-test (framework glue, trivial getters).

## Concepts to know
- Don't mock what you own — hide real implementations behind interfaces and swap those.
- Tests are specs; name them by behavior.
- Fast feedback matters more than cleverness. Keep tests dumb.

## Interview questions
- When does a unit test have value? When doesn't it?
- What do you mock? What don't you?
- Snapshot tests — when do they earn their keep?
