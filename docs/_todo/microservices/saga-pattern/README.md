# Saga pattern

**Category:** microservices · **Primary app:** [orders-event-driven](../../../../workspaces/apps/orders-event-driven/) · **Prereqs:** idempotency-retries · **Status:** todo

## Scope
- Orchestration (central coordinator) vs choreography (services react to events).
- Compensating actions for each step.
- Timeouts and retries at the saga level.
- State persistence for the coordinator.

## Sub-tasks
- [ ] Design the order saga: reserve stock → charge payment → confirm order; with compensations.
- [ ] Implement a saga coordinator (single service) that persists state per saga id.
- [ ] Emit compensation events on failure: cancel order, release stock, refund payment.
- [ ] Write a doc listing every failure mode and the corresponding compensation.

## Concepts to know
- Sagas replace distributed transactions; consistency is eventual.
- Compensation is not always possible — some actions are irreversible (email sent). Plan around them.
- Choreography scales org-wise but obscures flow; orchestration centralizes flow but couples to a service.
- Idempotency on every step is non-negotiable.

## Interview questions
- Orchestration vs choreography — when each?
- Saga for an order that reserves stock, charges payment, emails the user — what compensates what?
- A compensating step fails. Now what?
- How do you monitor a saga in flight?
