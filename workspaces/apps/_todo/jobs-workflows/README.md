<!-- TODO: Re-evaluate scope and approach before starting implementation. -->

# Jobs & Workflows

Build them in one monorepo (`nodejs-backend-mastery`) and reuse shared packages (config/logger/errors/metrics/testing).

- Why: Reliability patterns.
- Covers: Task queues (BullMQ), retries/backoff, dead-letter queues, idempotency, outbox pattern, cron jobs, Sagas (or Temporal if you want).
- Stack: Redis + BullMQ (or Temporal), Postgres outbox, metrics.
- Arch: Clean (ports for queue, mailer, sms).
- Stretch: Email pipeline (templates), PDF invoices, webhooks with signature verification.

## Deployment

- Target: ECS Fargate worker (BullMQ) and/or Step Functions/Lambda
- AWS: SQS, DLQ, EventBridge, Step Functions, CloudWatch Alarms

## CI/CD (GitHub Actions)

- Auth: OIDC to AWS
- Steps (ECS): Build worker image → push ECR → update ECS service
- Steps (Serverless): `cdk deploy` for workflows and scheduled jobs
- Extras: Retries/backoff policies, idempotency keys, outbox pattern
