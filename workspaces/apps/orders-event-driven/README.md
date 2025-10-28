<!-- TODO: Re-evaluate scope and approach before starting implementation. -->

# Event-Driven Order System (Mini-Microservices)

Build them in one monorepo (`nodejs-backend-mastery`) and reuse shared packages (config/logger/errors/metrics/testing).

- Why: Practice consistency & integration at scale.
- Covers: Services: Orders, Payments, Inventory; events/commands, eventual consistency, Sagas, outbox/inbox, schema registry, consumer groups.
- Stack: Kafka (or SQS/SNS), Postgres per service, OpenTelemetry + Prometheus.
- Arch: Modular monolith first → split into services.
- Stretch: Blue/green deploy of one service, contract testing (Pact).

## Deployment

- Target: ECS Fargate micro-services + SNS/SQS (or MSK)
- AWS: SNS topics, SQS queues, EventBridge, RDS per service, CloudWatch

## CI/CD (GitHub Actions)

- Auth: OIDC to AWS
- Steps: Build/push per service → update ECS services; migrations per service
- Extras: Outbox/inbox, consumer groups, contract tests
