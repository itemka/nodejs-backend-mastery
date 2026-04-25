# Idempotency, retries, DLQ, outbox

**Category:** microservices · **Primary app:** [orders-event-driven](../../../../workspaces/apps/orders-event-driven/) · **Prereqs:** event-driven · **Status:** todo

## Scope
- Idempotency keys on unsafe writes (orders, payments).
- Outbox pattern to solve the dual-write problem (DB write + publish).
- Retries with exponential backoff and jitter.
- Dead-letter queues for poison messages; replay tooling.

## Sub-tasks
- [ ] Add idempotency-key header support on `POST /orders`; dedupe on the key within TTL.
- [ ] Implement the outbox pattern in the `orders` service: write event rows in the same DB tx as the order.
- [ ] Build a relay that reads outbox rows and publishes them at-least-once.
- [ ] Make the `payments` consumer idempotent on the event's idempotency key.
- [ ] Configure an SQS DLQ for the consumer; alert on depth > 0.

## Concepts to know
- "Exactly-once" end-to-end is only achievable via idempotent consumers, not via the bus.
- Outbox trades storage + a relay for atomicity between DB state and event publish.
- Retry without jitter creates thundering herds.
- Replaying a DLQ needs the handler to still be idempotent.

## Interview questions
- Explain the dual-write problem and how the outbox pattern solves it.
- Client retries a payment POST — how do you prevent double-charging?
- A poison message is stuck in your SQS consumer. How do you protect throughput?
- Why is jitter on retries important?
- Design an at-least-once integration with idempotent consumers.
