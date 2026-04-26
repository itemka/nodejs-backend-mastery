# Node.js Backend Mastery

A practical, structured workspace for building scalable, secure, and maintainable backend systems with Node.js. The repo pairs a topic-by-topic learning roadmap with real apps that exercise the patterns end to end.

## Purpose

A personal reference for senior-level Node.js backend engineering: real apps over slides, production patterns over toy snippets, and notes that grow alongside the code rather than after it.

## Topics In Scope

The full topic tree, status, and per-topic notes live in [docs/README.md](docs/README.md). Areas covered include:

- Core Node.js: event loop, streams, child processes
- Frameworks: Express, Fastify, NestJS
- API design: REST, WebSockets, GraphQL, gRPC
- Architecture: MVC, feature-based, hexagonal, clean, DDD, CQRS
- Auth & security: sessions, JWT, OAuth/OIDC, RBAC/ABAC, rate limiting, secrets
- Data storage: PostgreSQL, Redis, DynamoDB, MongoDB
- Async processing: event-driven, BullMQ, scheduled jobs
- Microservices: API gateway, Kafka, idempotency, sagas
- Cloud: AWS (ECS, Lambda, S3/CloudFront), GCP, Azure
- DevOps: Docker, GitHub Actions, Terraform, Kubernetes
- Observability: Pino logging, Prometheus, OpenTelemetry, Grafana
- Testing & quality: Vitest/Jest units, integration, contract, mutation, static analysis

Most topics are still `todo` or `partial`; flip status in the same PR as the code.

## Repository Layout

- [docs/](docs/) — learning roadmap and per-topic notes; start at [docs/README.md](docs/README.md).
- [workspaces/apps/](workspaces/apps/) — runnable apps that exercise the patterns. Active: [shop-mvc-express](workspaces/apps/shop-mvc-express/), [local-llm-playground](workspaces/apps/local-llm-playground/). Other folders (and anything under `_todo/`) are scaffolds.
- [workspaces/packages/](workspaces/packages/) — shared libraries: [config](workspaces/packages/config/), [errors](workspaces/packages/errors/).
- [.agents/](.agents/) — AI-agent toolkit (rules, skills, agents, commands, checklists) shared by Codex, Claude Code, and Cursor. Entry point: [AGENTS.md](AGENTS.md).

## Tooling

- Package manager: `pnpm@10.33.0`
- Runtime: Node.js `>=22` (see [.nvmrc](.nvmrc))
- Workspaces: declared in [pnpm-workspace.yaml](pnpm-workspace.yaml)

Common root scripts:

```bash
pnpm install
pnpm run lint
pnpm run format:check
pnpm run typecheck
pnpm run test
pnpm run build
```

Use pnpm filters for app-specific work, for example `pnpm --filter local-llm-playground dev`.
