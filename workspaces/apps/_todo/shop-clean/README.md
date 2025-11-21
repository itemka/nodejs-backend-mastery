<!-- TODO: Re-evaluate scope and approach before starting implementation. -->

# Shop API — Clean/Hex variant

Build them in one monorepo (`nodejs-backend-mastery`) and reuse shared packages (config/logger/errors/metrics/testing).

- Why: CRUD, auth, carts, orders—your “hello, production”.
- Covers: REST design, validation, auth (access+refresh), RBAC, pagination, caching (Redis), migrations, transactions.
- Stack: Fastify/Express, Zod, Postgres (Drizzle/Prisma), Redis, OpenAPI, pino.
- Arch: Build 4 variants: MVC → Feature-based → Clean/Hex → Nest (same tests for all).
- Stretch: Idempotency keys, rate limiting, ETag/conditional GET.

## Deployment

- Target: AWS Lambda + API Gateway (REST)
- AWS: Lambda, API Gateway, DynamoDB (or RDS via RDS Proxy), Secrets Manager/SSM, CloudWatch

## CI/CD (GitHub Actions)

- Auth: OIDC to AWS
- Steps: `cdk synth` → `cdk deploy` (or SAM) with version + alias; canary deploy (10%/5m)
- Extras: Provisioned Concurrency for hot endpoints; Zod validation at edge
