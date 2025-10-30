<!-- TODO: Re-evaluate scope and approach before starting implementation. -->

# Shop API — Feature-based (Fastify)

Build them in one monorepo (`nodejs-backend-mastery`) and reuse shared packages (config/logger/errors/metrics/testing).

- Why: CRUD, auth, carts, orders—your “hello, production”.
- Covers: REST design, validation, auth (access+refresh), RBAC, pagination, caching (Redis), migrations, transactions.
- Stack: Fastify/Express, Zod, Postgres (Drizzle/Prisma), Redis, OpenAPI, pino.
- Arch: Build 4 variants: MVC → Feature-based → Clean/Hex → Nest (same tests for all).
- Stretch: Idempotency keys, rate limiting, ETag/conditional GET.

## Deployment

- Target: AWS ECS Fargate + ALB
- AWS: ECR, ECS, ALB, RDS Postgres, ElastiCache Redis, CloudWatch Logs/Metrics, Secrets Manager/SSM

## CI/CD (GitHub Actions)

- Auth: OIDC to AWS (no static keys)
- Steps: Docker build → push to ECR → `aws ecs update-service --force-new-deployment`
- Env: GitHub Environments (dev/stage/prod) with manual approval for prod
- Extras: Health checks, rolling deploy, alarms on 5xx and latency
