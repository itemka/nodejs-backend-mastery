<!-- TODO: Re-evaluate scope and approach before starting implementation. -->

# Shop API — Nest variant

Build them in one monorepo (`nodejs-backend-mastery`) and reuse shared packages (config/logger/errors/metrics/testing).

- Why: CRUD, auth, carts, orders—your “hello, production”.
- Covers: REST design, validation, auth (access+refresh), RBAC, pagination, caching (Redis), migrations, transactions.
- Stack: Fastify/Express, Zod, Postgres (Drizzle/Prisma), Redis, OpenAPI, pino.
- Arch: Build 4 variants: MVC → Feature-based → Clean/Hex → Nest (same tests for all).
- Stretch: Idempotency keys, rate limiting, ETag/conditional GET.

## Deployment

- Target: AWS EKS (Ingress NGINX/ALB)
- AWS: EKS, ECR, ALB, IAM Roles for Service Accounts (IRSA), cert-manager, CloudWatch

## CI/CD (GitHub Actions)

- Auth: OIDC to AWS
- Steps: Docker build → push to ECR → `kubectl` (Kustomize/Helm) apply
- Env: GitHub Environments with manual approval for prod
- Extras: HPA, liveness/readiness probes, ConfigMaps/Secrets management
