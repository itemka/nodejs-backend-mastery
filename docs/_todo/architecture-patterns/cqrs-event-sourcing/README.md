# CQRS + event sourcing

**Category:** architecture-patterns · **Primary app:** — · **Prereqs:** ddd, event-driven · **Status:** todo

## Scope

- CQRS: split read and write models.
- Event sourcing: persist the sequence of events, not the current state.
- Projections rebuild read models from the event stream.
- When the cost is worth it: audit, temporal queries, complex invariants.

## Sub-tasks

- [ ] Prototype a single aggregate with event sourcing (appendEvents + replay).
- [ ] Build a projection that updates a read model from the event stream.
- [ ] Write the trade-off note: what you pay (complexity, snapshotting, migration) vs what you gain.

## Concepts to know

- Snapshots avoid replaying millions of events.
- Upcasters / event versioning when schemas evolve.
- Read model eventual consistency; design UX for it.
- Event store choices: EventStoreDB, Postgres append-only table, Kafka.

## Interview questions

- When would you use event sourcing? When not?
- Explain CQRS without event sourcing — is it still useful?
- How do you handle schema evolution in an event-sourced system?
- What breaks when read models get out of sync with the event stream?
