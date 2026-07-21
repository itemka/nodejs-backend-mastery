# Shop MVC (Express)

**Status:** active — the backend flagship, earliest stage. Express 5 MVC with
server-rendered views and an in-memory product model. Has a first Vitest
regression suite (validation, escaping, central error handling, and Helmet
headers) and declares its shared `config`/`errors` dependencies. Next up: the
rest of the Phase 1 production baseline (logging + request IDs,
health/readiness), then Phase 2 (Postgres, migrations, Docker). See
[docs/README.md § App Order And Growth Phases](../../../docs/README.md#app-order-and-growth-phases).

## What it demonstrates today

- Express 5 MVC: implemented `/products` routes → controller → an in-memory
  product model (`src/models/product.ts`), with server-rendered views.
  `/admin` and `/auth` are mounted router stubs with no handlers yet.
- XSS-safe rendering: `escape-html` escapes product titles, validation
  messages, and error-page values; the branded `SafeHtml` type prevents raw
  strings from entering view renderers.
- Zod input validation at the form boundary: `src/schemas/product.schema.ts`
  is the single source for runtime validation and for the generated OpenAPI
  contract.
- OpenAPI 3.1 contract generated from those schemas
  (`src/openapi/document.ts` → `docs/openapi.json`), served as JSON at
  `/openapi.json` and as Swagger UI at `/docs`. Both routes are mounted only
  when `NODE_ENV !== 'production'`. CI fails if the committed
  `docs/openapi.json` is stale or does not lint.
- Security headers: helmet with explicit CSP, HSTS in prod, referrer policy.
- Central error middleware
  (`src/middleware/registerErrorHandlingMiddleware.ts`) translating shared
  `HttpError` types from [packages/errors](../../packages/errors/) to
  HTML/JSON; `wrapAsync` route wrapper.
- Graceful shutdown (`src/infra/shutdown.ts`) and env validation through the
  shared `defineEnv` helper (`src/env.ts`).

## Not here yet

Structured logger, request IDs, `/health` + `/ready`, any database, Docker.
These are Phase 1–2 work, tracked as sub-tasks in the matching topic READMEs
under `docs/_todo/` (express, logging, unit-testing, postgresql, docker).

## Scripts

```bash
pnpm --filter shop-mvc-express dev        # tsx watch
pnpm --filter shop-mvc-express typecheck
pnpm --filter shop-mvc-express test       # vitest run
pnpm --filter shop-mvc-express build      # esbuild
pnpm --filter shop-mvc-express openapi:generate  # rewrite docs/openapi.json
pnpm --filter shop-mvc-express openapi:check     # drift check + redocly lint
pnpm --filter shop-mvc-express start      # node dist/server.js
```

## Deployment (planned — Phase 6)

- Target: single VM + Docker Compose + Nginx (baseline ops)
- AWS: EC2 (or Lightsail), Route 53, ACM (TLS), optional S3 for backups
- CI/CD: build container → push GHCR/ECR → SSH to VM →
  `docker compose pull && docker compose up -d`; GitHub Environments with
  approvals for prod
