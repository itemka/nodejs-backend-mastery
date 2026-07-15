# Event-Driven Order System

**Status:** scaffold — planned Phase 4 (async processing and reliability),
app order #3. No code yet; this is a plan brief that absorbs the former
`jobs-workflows` brief. See
[docs/README.md § App Order And Growth Phases](../../../docs/README.md#app-order-and-growth-phases).

One reliability-focused service, not two:

- Why: practice consistency, integration, and reliability patterns at scale.
- Covers (start here, from the absorbed `jobs-workflows` scope): BullMQ task
  queues on Redis, retries + backoff, dead-letter queues, idempotency keys,
  Postgres outbox, cron jobs; timeouts + circuit breaker on the shop→auth
  call.
- Covers (later, event-driven depth): Orders/Payments/Inventory services,
  events vs commands, eventual consistency, sagas, outbox/inbox, consumer
  groups; Kafka or SNS/SQS as the bus comparison.
- Stack: Redis + BullMQ, Postgres (outbox), then Kafka or SQS/SNS;
  OpenTelemetry + Prometheus.
- Arch: modular monolith first → split into services.
- Stretch: blue/green deploy of one service, contract testing (Pact), email
  pipeline, webhooks with signature verification.

Done-bar for the phase: killing a worker mid-job retries without duplicate
side effects.

When implementation starts, reuse the existing shared packages
([config](../../packages/config/), [errors](../../packages/errors/)).

## Deployment (planned)

- Target: ECS Fargate services/workers + SNS/SQS (or MSK)
- AWS: SNS topics, SQS queues + DLQ, EventBridge, RDS per service, CloudWatch Alarms

## CI/CD (GitHub Actions, planned)

- Auth: OIDC to AWS
- Steps: build/push per service → update ECS services; migrations per service
- Extras: outbox/inbox, consumer groups, retries/backoff policies, contract tests
