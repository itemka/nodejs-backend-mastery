# Integration testing

**Category:** testing-quality · **Primary app:** [shop-mvc-express](../../../../workspaces/apps/shop-mvc-express/) · **Prereqs:** unit-testing · **Status:** todo

## Scope

- Real DB tests (Postgres via Testcontainers or docker-compose).
- Supertest for HTTP-level assertions.
- Isolation: per-test transaction rollback or schema reset.
- Fixtures and factories.

## Sub-tasks

- [ ] Wire Testcontainers Postgres into shop-mvc-express test suite.
- [ ] Supertest the full request → handler → DB → response path for products.
- [ ] Run integration tests in CI on push to main; keep unit tests on every PR.
- [ ] Document test data strategy in this file.

## Concepts to know

- Real DB tests catch migration and query bugs unit tests miss.
- Slow tests destroy feedback loops — keep integration to the critical paths.
- Shared mutable DB state is a flake generator.

## Interview questions

- Unit vs integration — where do you draw the line?
- How do you isolate state between integration tests?
- When do you hit an HTTP endpoint vs call the controller directly?
