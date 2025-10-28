<!-- TODO: Re-evaluate scope and approach before starting implementation. -->

# Shop MVC (Express)

## Why / Scope (from plan)

- CRUD, auth, carts, orders—your “hello, production”.
- Covers: REST design, validation, auth (access+refresh), RBAC, pagination, caching (Redis), migrations, transactions.
- Stack: Express, Zod, Postgres (Drizzle/Prisma), Redis, OpenAPI, pino.
- Variants: MVC → Feature-based → Clean/Hex → Nest (same tests for all).
- Stretch: Idempotency keys, rate limiting, ETag/conditional GET.

## Deployment

- Target: Single VM + Docker Compose + Nginx (baseline ops)
- AWS: EC2 (or Lightsail), Route 53, ACM (TLS), optional S3 for backups
- Notes: Learn Linux hardening, Nginx reverse proxy, SSL renewals, systemd service, log rotation

## CI/CD (GitHub Actions)

- Build container → push to GHCR/ECR → SSH to VM → `docker compose pull && docker compose up -d`
- Use GitHub Environments (dev/stage/prod) with approvals for prod
- Secrets in GitHub Environments; app config via `.env` or SSM if desired
