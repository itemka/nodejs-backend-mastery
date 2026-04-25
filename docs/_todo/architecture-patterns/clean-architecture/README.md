# Clean architecture

**Category:** architecture-patterns · **Primary app:** — · **Prereqs:** hexagonal · **Status:** todo

## Scope
- Four concentric rings: entities → use cases → interface adapters → frameworks/drivers.
- Dependency rule: source code dependencies only point inward.
- Use cases as first-class objects; one file per operation.

## Sub-tasks
- [ ] Re-implement one auth-service feature (login) as a use-case class with explicit port dependencies.
- [ ] Document the ring boundaries in this file with the actual folder layout you used.
- [ ] Note the overhead: file count, indirection, onboarding cost.

## Concepts to know
- Entities are enterprise-wide; use cases are application-specific.
- Interface adapters translate between use-case shapes and external tech.
- Frameworks (HTTP, DB clients) live at the outermost ring.

## Interview questions
- Explain the dependency rule. What does it prevent?
- When is Clean Architecture over-engineering?
- How does Clean differ from hexagonal in practice?
