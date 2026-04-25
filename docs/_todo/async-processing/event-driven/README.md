# Event-driven architecture

**Category:** async-processing · **Primary app:** [orders-event-driven](../../../../workspaces/apps/orders-event-driven/) · **Prereqs:** — · **Status:** todo

## Scope

- Domain events (inside a bounded context) vs integration events (between services).
- Event schemas and versioning.
- Eventual consistency and read-your-writes UX.
- Outbox pattern for reliable publishing (see [../../microservices/idempotency-retries/](../../microservices/idempotency-retries/)).

## Sub-tasks

- [ ] Split orders and payments services; define the integration events between them.
- [ ] Emit `OrderPlaced` / `PaymentCaptured` / `OrderCancelled` with versioned schemas.
- [ ] Keep a handler registry per service; one function per event type.
- [ ] Document how a new consumer joins without breaking existing ones.

## Concepts to know

- At-most-once / at-least-once / "exactly-once" (mostly a lie without idempotent consumers).
- Event carried state transfer vs notification — trade storage for decoupling.
- Schema evolution: add fields, don't remove or repurpose.
- Consumer failure should not block producer — durable bus.

## Interview questions

- Compare event-driven vs request/response for two services that must stay in sync.
- What does eventual consistency look like for the user of a shop?
- How do you evolve an event schema without breaking consumers?
- Give an example where event-driven is the wrong answer.
