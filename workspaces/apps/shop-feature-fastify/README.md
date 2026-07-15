# Shop API — Feature-based (Fastify)

**Status:** scaffold — planned Phase 5A (Fastify variant + performance depth),
app order #4. No code yet; this is a plan brief. See
[docs/README.md § App Order And Growth Phases](../../../docs/README.md#app-order-and-growth-phases).

- Why: same shop domain, second architecture — reuse the MVC shop's API tests
  as the contract.
- Covers: REST design, validation, auth (access+refresh), RBAC, pagination,
  caching (Redis), migrations, transactions; Prometheus metrics +
  OpenTelemetry tracing land here; autocannon benchmark against the MVC
  variant.
- Stack: Fastify, Zod, Postgres (Drizzle), Redis, OpenAPI, pino.
- Arch: feature-based modules. Clean/hex and Nest variants stay deferred
  briefs (`shop-clean`, `shop-nest`) — later refactor exercises, not new apps.
- Stretch: idempotency keys, rate limiting, ETag/conditional GET.

When implementation starts, reuse the existing shared packages
([config](../../packages/config/), [errors](../../packages/errors/)).

## Deployment (planned)

- Target: AWS ECS Fargate + ALB
- AWS: ECR, ECS, ALB, RDS Postgres, ElastiCache Redis, CloudWatch Logs/Metrics, Secrets Manager/SSM

## CI/CD (GitHub Actions, planned)

- Auth: OIDC to AWS (no static keys)
- Steps: Docker build → push to ECR → `aws ecs update-service --force-new-deployment`
- Env: GitHub Environments (dev/stage/prod) with manual approval for prod
- Extras: health checks, rolling deploy, alarms on 5xx and latency
