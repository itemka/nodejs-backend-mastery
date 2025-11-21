<!-- TODO: Re-evaluate scope and approach before starting implementation. -->

# Payments & Billing (SaaS, Multi-Tenant)

Build them in one monorepo (`nodejs-backend-mastery`) and reuse shared packages (config/logger/errors/metrics/testing).

- Why: Money + tenancy is where complexity spikes.
- Covers: Stripe checkout + webhooks, invoices, subscription state machine, proration, tenant isolation (schema vs row-level), audit logs.
- Stack: Stripe, Postgres (Row Level Security or per-schema), Redis.
- Arch: Clean + strong boundaries.
- Stretch: Usage-based metering, dunning, exportable audit trail.

## Deployment

- Target: AWS ECS Fargate (Stripe webhooks via API Gateway → Lambda or direct to ECS)
- AWS: ECR/ECS, RDS (RLS/tenancy), SQS (outbox), API Gateway (webhooks), CloudWatch

## CI/CD (GitHub Actions)

- Auth: OIDC to AWS
- Steps: Build → push ECR → ECS update; deploy webhook Lambda/CDK if used
- Extras: Idempotency keys, signature verification, dunning schedules
