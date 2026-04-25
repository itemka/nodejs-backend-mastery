# Hexagonal / ports & adapters

**Category:** architecture-patterns · **Primary app:** [auth-service](../../../../workspaces/apps/auth-service/) · **Prereqs:** feature-based · **Status:** todo

## Scope
- Domain core defines ports (interfaces); adapters plug in infra (DB, HTTP, queues).
- Dependency direction: everything points inward to the domain.
- Testability: in-memory adapters for unit tests, real adapters for integration.

## Sub-tasks
- [ ] Organize auth-service into `domain/`, `application/`, `adapters/`.
- [ ] Define ports: `UserRepository`, `TokenStore`, `Mailer`, `OAuthClient`.
- [ ] Write the authN use-cases as pure functions / classes depending only on ports.
- [ ] Provide in-memory adapters for testing and Postgres/Redis/SES adapters for prod.

## Concepts to know
- Keep framework types (Fastify req/res) out of the domain layer.
- Adapters own validation + serialization at the edge.
- Hexagonal is feature-based with stronger internal boundaries.

## Interview questions
- Explain ports and adapters. What does it buy you over plain layered?
- When does hexagonal become over-engineering?
- How do you test the domain layer vs the adapters?
