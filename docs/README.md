# nodejs-backend-mastery — docs

Personal workspace for building senior Node.js backend skill through a small number of real apps. Terminal goal: be fluent enough to design, build, deploy, and defend in interviews the patterns in the topic tree.

Use this file as the single top-level docs roadmap. Each topic still keeps its own `README.md` under `docs/_todo/**/README.md`; open the topic folder when you start that step and update it as you build.

## Structure

All topic content is sharded into per-topic folders under [\_todo/](./_todo/). Every topic folder has a `README.md` with four sections:

- **Metadata** — category, primary app, prereqs, status (`todo` · `partial` · `done`).
- **Scope** — what this topic actually covers.
- **Sub-tasks** — small, AI-promptable work items. The ordered union across all folders is the roadmap.
- **Concepts + Interview questions** — pointers to prep; answer from real code under `workspaces/apps/*`.

## Repo Pointers

- Real apps: [workspaces/apps/shop-mvc-express/](../workspaces/apps/shop-mvc-express/), [workspaces/apps/local-llm-playground/](../workspaces/apps/local-llm-playground/)
- Scaffold apps (committed order below): `auth-service`, `orders-event-driven`, `shop-feature-fastify`, `chat-ws`, `serverless-toolkit`
- Scratch app briefs (deferred): `workspaces/apps/_todo/*` — `analytics-pipeline`, `bff-gateway`, `blog-graphql`, `iot-telemetry`, `media-service`, `payments-billing`, `shop-clean`, `shop-nest`.
- AI engineering examples: [workspaces/ai-engineering/llm-chat/](../workspaces/ai-engineering/llm-chat/) (interactive Claude chat CLI with tool use), [workspaces/ai-engineering/mcp-chat/](../workspaces/ai-engineering/mcp-chat/) (MCP server + CLI client), [workspaces/ai-engineering/prompt-eval-lab/](../workspaces/ai-engineering/prompt-eval-lab/) (dataset-driven prompt evaluation CLI), [workspaces/ai-engineering/rag-pipeline/](../workspaces/ai-engineering/rag-pipeline/) (retrieval service with hybrid search), [workspaces/ai-engineering/claude-capabilities-lab/](../workspaces/ai-engineering/claude-capabilities-lab/) (scenario CLI for Claude-specific capabilities).
- Shared libs: [workspaces/packages/cli-output/](../workspaces/packages/cli-output/) (semantic terminal theme), [workspaces/packages/config/](../workspaces/packages/config/) (Zod env loader), [workspaces/packages/errors/](../workspaces/packages/errors/) (HTTP error hierarchy), [workspaces/packages/llm-client/](../workspaces/packages/llm-client/) (provider-neutral LLM client with an Anthropic adapter).

## Working Rules

- Each sub-task is a single AI prompt: one verb, one target, one outcome.
- Flip the status line (`todo` → `partial` → `done`) in the same PR that lands the code.
- Add interview Q&A under the relevant topic folder as you implement, not in a final push.
- Keep notes short; code and commit messages are authoritative.
- Apps under `workspaces/apps/_todo/` and anything under a `_todo/` prefix here are scratch until a note lands.

## Per-Topic Workflow

Use this loop when you pick something up from the topic index:

1. **Learn** the minimum theory (15-45 min). The topic's README lists the core concepts.
2. **Build** a small slice in the primary app named in the topic README.
3. **Document** by updating the same topic README: flip the status, fill in code references, capture one non-obvious thing you learned.
4. **Interview story** — add the pattern + file link + one trade-off under the topic README's `Interview questions` section.

Status transitions:

- `todo` → `partial`: implemented OR written up, not both.
- `partial` → `done`: code merged + tests (where relevant) + a code-linked
  interview answer in the topic README — and you can explain it cold.

Cadence:

- Do not batch updates at "end of phase." Flip status in the same PR as the code.
- Revisit `partial` entries every few weeks — they tend to rot first.
- When a topic's README gets > 100 lines, it probably wants to split into sub-topics.

Picking the next topic:

- Scan the topic index below for `todo` items whose prereqs are `done` or `partial`.
- Prefer topics tied to an app you're already touching this week.
- Don't skip [observability](./_todo/observability/) and [testing-quality](./_todo/testing-quality/) folders — they lag everything else if you do.

## App Order And Growth Phases

One critical path: deepen the current app until its phase is done; a new app
enters only when its phase needs a pattern the previous app cannot host.
Observability and testing are threaded through every phase, not saved for the
end. (`local-llm-playground` evolves independently on the AI track.)

Committed app order:

1. [shop-mvc-express](../workspaces/apps/shop-mvc-express/) — active; deepen through Phases 1–2 before anything else.
2. [auth-service](../workspaces/apps/auth-service/) — scaffold; Phase 3.
3. [orders-event-driven](../workspaces/apps/orders-event-driven/) — scaffold; Phase 4 (absorbs the former `jobs-workflows` brief).
4. [shop-feature-fastify](../workspaces/apps/shop-feature-fastify/) — scaffold; Phase 5A.
5. [chat-ws](../workspaces/apps/chat-ws/) — scaffold; Phase 5B, after the Fastify milestone.
6. [serverless-toolkit](../workspaces/apps/serverless-toolkit/) — scaffold; Phase 6 (absorbs the `media-service` S3/CloudFront scope).

Deferred briefs stay in `workspaces/apps/_todo/` until a phase needs them;
`shop-clean` and `shop-nest` are later refactor exercises of the Fastify
variant, not new apps.

Growth phases (plan each milestone when you start it; Phase 5 has ordered A/B
milestones because realtime needs a separate app):

- **Phase 1 — shop-mvc-express production baseline (no DB yet):** Vitest +
  first unit tests (validation, error middleware, HTML escaping); structured
  logging + request-ID middleware; `/health` + `/ready` wired to the existing
  shutdown drain; declare the shared config and errors packages as workspace
  dependencies. Warm-up: tests for `packages/config` + `packages/errors`.
- **Phase 2 — database + testing + observability baseline:** Postgres via
  Drizzle (schema, migrations, seed, compose); order creation in a
  transaction with a rollback-proving test; integration tests; Vitest
  coverage wired into Sonar; multi-stage Dockerfile + CI docker-build step.
- **Phase 3 — auth/security:** sessions in the shop app first, then a real
  `auth-service` (Fastify, hexagonal): argon2, JWT access + rotating refresh,
  revocation, rate-limited login, RBAC consumed by the shop app; OpenAPI spec
  from day one.
- **Phase 4 — async processing and reliability:** `orders-event-driven` with
  BullMQ + Redis: retries + backoff, DLQ, idempotency keys, Postgres outbox;
  timeouts + circuit breaker on the shop→auth call.
- **Phase 5A — Fastify/feature-based variant + performance depth:**
  `shop-feature-fastify` reusing the shop's API tests as the contract;
  Prometheus metrics + OpenTelemetry tracing; autocannon benchmarks of both
  variants.
- **Phase 5B — realtime systems:** `chat-ws` with WebSocket rooms, presence,
  delivery acknowledgements, backpressure, flood control, and horizontal
  scaling through Redis pub/sub. Reuse the established Postgres, auth,
  observability, and contract-testing baselines instead of rebuilding them.
- **Phase 6 — cloud/deployment:** deploy `shop-mvc-express` (VM + compose +
  Nginx + GHCR + GitHub Environments); then OIDC-to-AWS ECS Fargate with a
  minimal Terraform/CDK stack. After that baseline, implement one
  `serverless-toolkit` vertical slice with API Gateway + Lambda, DynamoDB, S3
  presigned uploads, streaming downloads with backpressure, CloudFront
  delivery, and CDK-managed infrastructure.
- **Phase 7 — system design and portfolio polish:** `docs/adr/` with the
  first real ADRs; extend the C4 model and per-app workflow docs with the
  backend apps; per-app "Interview story" README sections; verify every
  `done` topic has code link + test link + interview answer.

## Topic Index

Every row links to a topic folder with its own `README.md`. Status: `todo` · `partial` · `done`. Flip in the same PR as the code.

Tier: `core` = the senior critical path, done in phase order; `elective` =
deferred by default — pick one up only after the core topics that motivate it
are done.

### Core Node.js

- [\_todo/core-nodejs/event-loop/](./_todo/core-nodejs/event-loop/) — single-threaded I/O model. Prereq: —. App: all. **todo** · core
- [\_todo/core-nodejs/streams-buffering/](./_todo/core-nodejs/streams-buffering/) — streams + backpressure. Prereq: event-loop. App: serverless-toolkit. **todo** · core
- [\_todo/core-nodejs/child-process-cluster/](./_todo/core-nodejs/child-process-cluster/) — workers, cluster, IPC. Prereq: event-loop. App: —. **todo** · core
- [\_todo/core-nodejs/native-modules/](./_todo/core-nodejs/native-modules/) — N-API add-ons. Prereq: streams. App: —. **todo** · elective

### Frameworks

- [\_todo/frameworks/express/](./_todo/frameworks/express/) — middleware, lifecycle, error handling. Prereq: event-loop. App: shop-mvc-express. **partial** · core
- [\_todo/frameworks/fastify/](./_todo/frameworks/fastify/) — plugins, hooks, type providers. Prereq: express. App: auth-service, shop-feature-fastify. **todo** · core
- [\_todo/frameworks/nestjs/](./_todo/frameworks/nestjs/) — modules, DI container. Prereq: fastify. App: —. **todo** · elective
- [\_todo/frameworks/deno-fresh/](./_todo/frameworks/deno-fresh/) — comparison only. Prereq: —. App: —. **todo** · elective

### API Design

- [\_todo/api-design/rest/](./_todo/api-design/rest/) — resources, verbs, status, versioning, OpenAPI. Prereq: express. App: shop-mvc-express. **partial** · core
- [\_todo/api-design/websockets/](./_todo/api-design/websockets/) — WS protocol, rooms, presence. Prereq: event-loop. App: chat-ws. **todo** · core
- [\_todo/api-design/realtime-patterns/](./_todo/api-design/realtime-patterns/) — SSE / long-poll / WS trade-offs. Prereq: websockets. App: chat-ws. **todo** · core
- [\_todo/api-design/graphql/](./_todo/api-design/graphql/) — schema-first vs code-first. Prereq: rest. App: —. **todo** · elective
- [\_todo/api-design/grpc/](./_todo/api-design/grpc/) — protobuf, streaming. Prereq: rest. App: —. **todo** · elective

### Architecture Patterns

- [\_todo/architecture-patterns/mvc-layered/](./_todo/architecture-patterns/mvc-layered/) — MVC + feature-based. Prereq: express. App: shop-mvc-express, shop-feature-fastify. **partial** · core
- [\_todo/architecture-patterns/hexagonal-ports-adapters/](./_todo/architecture-patterns/hexagonal-ports-adapters/) — domain-centric, swappable infra. Prereq: feature-based. App: auth-service. **todo** · core
- [\_todo/architecture-patterns/clean-architecture/](./_todo/architecture-patterns/clean-architecture/) — layered dependency rule. Prereq: hexagonal. App: —. **todo** · elective
- [\_todo/architecture-patterns/ddd/](./_todo/architecture-patterns/ddd/) — tactical patterns. Prereq: clean. App: —. **todo** · elective
- [\_todo/architecture-patterns/cqrs-event-sourcing/](./_todo/architecture-patterns/cqrs-event-sourcing/) — CQRS + ES. Prereq: ddd + event-driven. App: —. **todo** · elective
- [\_todo/architecture-patterns/service-meshes/](./_todo/architecture-patterns/service-meshes/) — Istio / Linkerd. Prereq: microservices. App: —. **todo** · elective

### Auth & Security

- [\_todo/auth-security/input-validation/](./_todo/auth-security/input-validation/) — Zod at boundaries. Prereq: express. App: shop-mvc-express. **partial** · core
- [\_todo/auth-security/sessions/](./_todo/auth-security/sessions/) — server-side session state. Prereq: express. App: shop-mvc-express. **todo** · core
- [\_todo/auth-security/jwt/](./_todo/auth-security/jwt/) — JWT access + refresh. Prereq: sessions. App: auth-service. **todo** · core
- [\_todo/auth-security/oauth-openid/](./_todo/auth-security/oauth-openid/) — OAuth2 / OIDC. Prereq: jwt. App: auth-service. **todo** · core
- [\_todo/auth-security/rbac-abac/](./_todo/auth-security/rbac-abac/) — role- and attribute-based authz. Prereq: jwt. App: auth-service. **todo** · core
- [\_todo/auth-security/rate-limiting/](./_todo/auth-security/rate-limiting/) — token bucket, sliding window. Prereq: —. App: auth-service. **todo** · core
- [\_todo/auth-security/secret-management/](./_todo/auth-security/secret-management/) — Secrets Manager / SSM. Prereq: aws. App: shop-feature-fastify. **todo** · core
- [\_todo/auth-security/secure-headers/](./_todo/auth-security/secure-headers/) — Helmet, CSP. Prereq: express. App: shop-mvc-express. **partial** · core

### Data Storage

- [\_todo/data-storage/relational/postgresql/](./_todo/data-storage/relational/postgresql/) — schema, indexes, tx, queries. Prereq: —. App: shop-mvc-express. **todo** · core
- [\_todo/data-storage/relational/mysql/](./_todo/data-storage/relational/mysql/) — comparison. Prereq: postgresql. App: —. **todo** · elective
- [\_todo/data-storage/caching/redis/](./_todo/data-storage/caching/redis/) — cache-aside, TTL, pub/sub. Prereq: postgresql. App: auth-service, orders-event-driven, shop-feature-fastify, chat-ws. **todo** · core
- [\_todo/data-storage/caching/cdn-strategies/](./_todo/data-storage/caching/cdn-strategies/) — edge caching. Prereq: redis. App: serverless-toolkit. **todo** · elective
- [\_todo/data-storage/nosql/dynamodb/](./_todo/data-storage/nosql/dynamodb/) — single-table design. Prereq: —. App: serverless-toolkit. **todo** · core
- [\_todo/data-storage/nosql/mongodb/](./_todo/data-storage/nosql/mongodb/) — document modeling. Prereq: —. App: —. **todo** · elective
- [\_todo/data-storage/graph-db/](./_todo/data-storage/graph-db/) — Neo4j. Prereq: —. App: —. **todo** · elective
- [\_todo/data-storage/time-series/](./_todo/data-storage/time-series/) — Timescale / Influx. Prereq: postgresql. App: —. **todo** · elective

### Async Processing

- [\_todo/async-processing/event-driven/](./_todo/async-processing/event-driven/) — domain vs integration events. Prereq: —. App: orders-event-driven. **todo** · core
- [\_todo/async-processing/job-queues-bullmq/](./_todo/async-processing/job-queues-bullmq/) — BullMQ worker + retries. Prereq: redis. App: orders-event-driven. **todo** · core
- [\_todo/async-processing/schedule-cron/](./_todo/async-processing/schedule-cron/) — cron / EventBridge. Prereq: —. App: serverless-toolkit. **todo** · core

### Microservices

- [\_todo/microservices/api-gateway/](./_todo/microservices/api-gateway/) — BFF, gateway patterns. Prereq: rest. App: bff-gateway (deferred brief). **todo** · elective
- [\_todo/microservices/event-bus-kafka/](./_todo/microservices/event-bus-kafka/) — Kafka / SNS+SQS. Prereq: event-driven. App: —. **todo** · elective
- [\_todo/microservices/idempotency-retries/](./_todo/microservices/idempotency-retries/) — idempotency keys, DLQ, retries. Prereq: event-driven. App: orders-event-driven. **todo** · core
- [\_todo/microservices/saga-pattern/](./_todo/microservices/saga-pattern/) — orchestration vs choreography. Prereq: idempotency. App: orders-event-driven. **todo** · core
- [\_todo/microservices/service-discovery/](./_todo/microservices/service-discovery/) — DNS, registry. Prereq: microservices. App: —. **todo** · elective

### Reliability & Resilience

- [\_todo/reliability-resilience/](./_todo/reliability-resilience/) — timeouts, circuit breakers, load shedding, graceful degradation. Prereq: event-driven. App: orders-event-driven, shop-mvc-express. **todo** · core

### Cloud Services

- [\_todo/cloud-services/aws/](./_todo/cloud-services/aws/) — ECS Fargate, RDS, ElastiCache, VPC. Prereq: docker. App: shop-feature-fastify. **todo** · core
- [\_todo/cloud-services/aws/lambda-api-gateway/](./_todo/cloud-services/aws/lambda-api-gateway/) — serverless HTTP. Prereq: aws. App: serverless-toolkit. **todo** · core
- [\_todo/cloud-services/aws/s3-cloudfront/](./_todo/cloud-services/aws/s3-cloudfront/) — object storage + CDN. Prereq: aws. App: serverless-toolkit. **todo** · core
- [\_todo/cloud-services/aws/serverless-framework/](./_todo/cloud-services/aws/serverless-framework/) — SAM / Serverless FW / CDK. Prereq: lambda-api-gateway. App: serverless-toolkit. **todo** · core
- [\_todo/cloud-services/gcp/](./_todo/cloud-services/gcp/) — comparison. Prereq: aws. App: —. **todo** · elective
- [\_todo/cloud-services/azure/](./_todo/cloud-services/azure/) — comparison. Prereq: aws. App: —. **todo** · elective

### DevOps / CI-CD

- [\_todo/devops-ci-cd/docker/](./_todo/devops-ci-cd/docker/) — multi-stage, compose. Prereq: —. App: shop-mvc-express. **todo** · core
- [\_todo/devops-ci-cd/github-actions/](./_todo/devops-ci-cd/github-actions/) — CI/CD pipelines. Prereq: docker. App: shop-mvc-express. **partial** · core
- [\_todo/devops-ci-cd/terraform-iac/](./_todo/devops-ci-cd/terraform-iac/) — CDK / Terraform. Prereq: aws. App: shop-feature-fastify. **todo** · core
- [\_todo/devops-ci-cd/kubernetes/](./_todo/devops-ci-cd/kubernetes/) — EKS, helm. Prereq: docker. App: —. **todo** · elective
- [\_todo/devops-ci-cd/git-strategies/](./_todo/devops-ci-cd/git-strategies/) — trunk-based, gitflow. Prereq: —. App: —. **todo** · elective

### Deployment Strategies

- [\_todo/deployment-strategies/blue-green/](./_todo/deployment-strategies/blue-green/) — blue-green cutover. Prereq: ecs-fargate. App: —. **todo** · core
- [\_todo/deployment-strategies/canary/](./_todo/deployment-strategies/canary/) — canary + auto-rollback. Prereq: ecs-fargate. App: —. **todo** · core
- [\_todo/deployment-strategies/feature-flags/](./_todo/deployment-strategies/feature-flags/) — flag-driven rollout. Prereq: —. App: —. **todo** · core

### Observability

- [\_todo/observability/logging/](./_todo/observability/logging/) — Pino + request IDs. Prereq: express. App: shop-mvc-express. **todo** · core
- [\_todo/observability/metrics-prometheus/](./_todo/observability/metrics-prometheus/) — RED/USE, histograms. Prereq: logging. App: shop-feature-fastify. **todo** · core
- [\_todo/observability/tracing-opentelemetry/](./_todo/observability/tracing-opentelemetry/) — spans, propagation. Prereq: logging. App: shop-feature-fastify. **todo** · core
- [\_todo/observability/alerting-grafana/](./_todo/observability/alerting-grafana/) — alerts + SLOs. Prereq: metrics. App: shop-feature-fastify. **todo** · core

### Performance

- [\_todo/performance-optimization/profiling/](./_todo/performance-optimization/profiling/) — --prof, clinic. Prereq: event-loop. App: shop-feature-fastify. **todo** · core
- [\_todo/performance-optimization/benchmarking-autocannon/](./_todo/performance-optimization/benchmarking-autocannon/) — autocannon, k6. Prereq: —. App: shop-feature-fastify. **todo** · core
- [\_todo/performance-optimization/memory-leaks/](./_todo/performance-optimization/memory-leaks/) — heap snapshots. Prereq: profiling. App: —. **todo** · core
- [\_todo/performance-optimization/scalability-patterns/](./_todo/performance-optimization/scalability-patterns/) — HPA, read replicas, sharding. Prereq: ecs-fargate. App: shop-feature-fastify. **todo** · core

### Testing & Quality

- [\_todo/testing-quality/unit-testing/](./_todo/testing-quality/unit-testing/) — Vitest units. Prereq: —. App: all. **partial** · core
- [\_todo/testing-quality/integration-testing/](./_todo/testing-quality/integration-testing/) — real DB tests. Prereq: unit-testing. App: shop-mvc-express. **todo** · core
- [\_todo/testing-quality/contract-testing/](./_todo/testing-quality/contract-testing/) — Pact. Prereq: integration. App: shop-feature-fastify ↔ auth-service. **todo** · core
- [\_todo/testing-quality/mutation-testing/](./_todo/testing-quality/mutation-testing/) — Stryker. Prereq: unit-testing. App: —. **partial** · elective
- [\_todo/testing-quality/static-analysis/](./_todo/testing-quality/static-analysis/) — ESLint typed, Sonar. Prereq: —. App: all. **partial** · core

### Compliance & Governance

- [\_todo/compliance-governance/threat-modeling/](./_todo/compliance-governance/threat-modeling/) — STRIDE. Prereq: —. App: auth-service. **todo** · core
- [\_todo/compliance-governance/gdpr/](./_todo/compliance-governance/gdpr/) — data subject rights. Prereq: —. App: shop-feature-fastify. **todo** · elective
- [\_todo/compliance-governance/pci-dss/](./_todo/compliance-governance/pci-dss/) — cardholder scope. Prereq: —. App: orders-event-driven. **todo** · elective

## System Design Prep

Prepare one concrete answer per problem, grounded in an app you built. Reference topic folders for deep-dives.

Approach for a 40-45 minute answer:

1. **Clarify** functional + non-functional requirements; agree on scale targets.
2. **High-level** components + data flow sketch.
3. **Data model**: tables/keys, access patterns. Use the [\_todo/data-storage/](./_todo/data-storage/) folders for storage prep.
4. **Deep dive** on the one or two trickiest components, usually storage or fan-out.
5. **Trade-offs**: failure modes, bottlenecks, alternatives.

### E-Commerce Platform

**Reference:** [shop-feature-fastify](../workspaces/apps/shop-feature-fastify/) · [postgresql](./_todo/data-storage/relational/postgresql/) · [redis](./_todo/data-storage/caching/redis/) · [aws](./_todo/cloud-services/aws/)

- Product catalog at millions of rows, cart, checkout, payment webhook, search.
- Scaling levers: cache, read replicas, CDN for assets, async order processing via SQS.

### Chat Service

**Reference:** [chat-ws](../workspaces/apps/chat-ws/) · [websockets](./_todo/api-design/websockets/) · [realtime-patterns](./_todo/api-design/realtime-patterns/)

- WebSockets, rooms, presence, history, 100K concurrent connections.
- Scaling levers: Redis pub/sub, ALB + sticky sessions, Postgres history, presence in Redis hash.

### Auth System

**Reference:** [auth-service](../workspaces/apps/auth-service/) · [jwt](./_todo/auth-security/jwt/) · [oauth-openid](./_todo/auth-security/oauth-openid/) · [rbac-abac](./_todo/auth-security/rbac-abac/)

- Signup, login, OAuth, refresh rotation, MFA, session revocation.
- Security: argon2, rate limit on login, short access + rotated refresh, blacklist on logout.

### URL Shortener

- Short-code generation: base62 or hash-prefix; hot-key caching; analytics pipeline.
- Reads dominate; cache the hot 20%; eventual consistency for click counters.

### File Storage

**Reference:** [s3-cloudfront](./_todo/cloud-services/aws/s3-cloudfront/)

- Multipart upload, presigned URLs, access control, CDN edge.

### Newsfeed / Timeline

- Fan-out-on-write (push) vs fan-out-on-read (pull) vs hybrid.
- Celebrity problem: don't materialize to millions of timelines on post.

### Rate Limiter Service

**Reference:** [rate-limiting](./_todo/auth-security/rate-limiting/)

- Token bucket vs leaky bucket; distributed via Redis with Lua for atomicity.

### Scheduler

**Reference:** [schedule-cron](./_todo/async-processing/schedule-cron/)

- Delayed jobs, retries, durability; leader election or EventBridge; idempotent handlers.

### Observability Backend

**Reference:** [metrics-prometheus](./_todo/observability/metrics-prometheus/) · [tracing-opentelemetry](./_todo/observability/tracing-opentelemetry/)

- Metrics ingest + aggregation; cardinality control; retention tiers.

### Social Graph / Follower Service

- Adjacency lists in Postgres/DynamoDB vs graph DB; caching hot users.

## Behavioral Prep

Prepare 4-6 stories in STAR format: Situation, Task, Action, Result. Reuse the same story across questions when it fits; what matters is the specifics you can narrate.

Themes:

- **A hard bug.** Symptom, isolation, root cause, and the process change you made afterward.
- **A trade-off.** Options considered, factors weighed, decision, retrospective.
- **A disagreement.** With a senior engineer / PM / architect; how you handled it.
- **A production incident.** Your role, impact, recovery, post-mortem actions.
- **A deprecation or migration you led.** Blast radius, rollback plan, communication.
- **A feature you cut or pushed back on.** How you justified it.
- **Mentorship / code review.** A concrete example with outcome.

Representative questions:

- Tell me about a technical decision you now regret.
- Walk me through a PR you are proud of.
- A teammate ships buggy code repeatedly. What do you do?
- You have 2 weeks and three "P1" tasks. How do you prioritize?
- Describe how you stay current technically.
- Tell me about a time you had to convince someone without authority.
- When was the last time you learned something that changed how you work?
- Describe your worst outage. What did you change after?
- A spec is ambiguous and your manager is unavailable. What do you do?

Preparation rule: for every story, write down exact dates, numbers (users affected, latency, money saved), tools used, people roles (not names), and what you'd do differently. Vagueness kills a behavioral answer.
