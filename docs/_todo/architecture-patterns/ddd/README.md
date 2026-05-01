# Domain-Driven Design (tactical)

**Category:** architecture-patterns · **Primary app:** — · **Prereqs:** clean-architecture · **Status:** todo

## Scope

- Tactical patterns: entities, value objects, aggregates, domain services, domain events.
- Bounded contexts and context maps.
- Anti-corruption layer for integrating legacy or third-party systems.
- Ubiquitous language and how it maps to code.

## Sub-tasks

- [ ] Pick one aggregate root in the shop (e.g. `Order`) and model it with invariants enforced in code.
- [ ] Emit a domain event on aggregate state change; wire a handler in the application layer.
- [ ] Write a short context map showing shop / auth / payments boundaries.

## Concepts to know

- Aggregates enforce invariants; all changes go through the root.
- Value objects are immutable and equality-by-value.
- Domain events capture facts; don't confuse with integration events.
- Eventual consistency _between_ aggregates is the norm; strong consistency _within_ an aggregate.

## Interview questions

- What is an aggregate root and why does it matter?
- Difference between a domain event and an integration event.
- How do you keep aggregates consistent when a transaction touches two of them?
- When would DDD be overkill?
