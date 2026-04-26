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
- Scaffold apps: `auth-service`, `bff-gateway`, `chat-ws`, `media-service`, `orders-event-driven`, `serverless-toolkit`, `shop-feature-fastify`
- Scratch app briefs: `workspaces/apps/_todo/*`, including `jobs-workflows` for BullMQ / workflow reliability.
- Shared libs: [workspaces/packages/config/](../workspaces/packages/config/), [workspaces/packages/errors/](../workspaces/packages/errors/)

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
- `partial` → `done`: implemented AND written up AND you can explain it cold.

Cadence:

- Do not batch updates at "end of phase." Flip status in the same PR as the code.
- Revisit `partial` entries every few weeks — they tend to rot first.
- When a topic's README gets > 100 lines, it probably wants to split into sub-topics.

Picking the next topic:

- Scan the topic index below for `todo` items whose prereqs are `done` or `partial`.
- Prefer topics tied to an app you're already touching this week.
- Don't skip [observability](./_todo/observability/) and [testing-quality](./_todo/testing-quality/) folders — they lag everything else if you do.

## Topic Index

Every row links to a topic folder with its own `README.md`. Status: `todo` · `partial` · `done`. Flip in the same PR as the code.

### Core Node.js

- [\_todo/core-nodejs/event-loop/](./_todo/core-nodejs/event-loop/) — single-threaded I/O model. Prereq: —. App: all. **todo**
- [\_todo/core-nodejs/streams-buffering/](./_todo/core-nodejs/streams-buffering/) — streams + backpressure. Prereq: event-loop. App: media-service. **todo**
- [\_todo/core-nodejs/child-process-cluster/](./_todo/core-nodejs/child-process-cluster/) — workers, cluster, IPC. Prereq: event-loop. App: —. **todo**
- [\_todo/core-nodejs/native-modules/](./_todo/core-nodejs/native-modules/) — N-API add-ons. Prereq: streams. App: —. **todo**

### Frameworks

- [\_todo/frameworks/express/](./_todo/frameworks/express/) — middleware, lifecycle, error handling. Prereq: event-loop. App: shop-mvc-express. **partial**
- [\_todo/frameworks/fastify/](./_todo/frameworks/fastify/) — plugins, hooks, type providers. Prereq: express. App: shop-feature-fastify. **todo**
- [\_todo/frameworks/nestjs/](./_todo/frameworks/nestjs/) — modules, DI container. Prereq: fastify. App: —. **todo**
- [\_todo/frameworks/deno-fresh/](./_todo/frameworks/deno-fresh/) — comparison only. Prereq: —. App: —. **todo**

### API Design

- [\_todo/api-design/rest/](./_todo/api-design/rest/) — resources, verbs, status, versioning. Prereq: express. App: shop-mvc-express. **partial**
- [\_todo/api-design/websockets/](./_todo/api-design/websockets/) — WS protocol, rooms, presence. Prereq: event-loop. App: chat-ws. **todo**
- [\_todo/api-design/realtime-patterns/](./_todo/api-design/realtime-patterns/) — SSE / long-poll / WS trade-offs. Prereq: websockets. App: chat-ws. **todo**
- [\_todo/api-design/graphql/](./_todo/api-design/graphql/) — schema-first vs code-first. Prereq: rest. App: —. **todo**
- [\_todo/api-design/grpc/](./_todo/api-design/grpc/) — protobuf, streaming. Prereq: rest. App: —. **todo**

### Architecture Patterns

- [\_todo/architecture-patterns/mvc-layered/](./_todo/architecture-patterns/mvc-layered/) — MVC + feature-based. Prereq: express. App: shop-mvc-express, shop-feature-fastify. **partial**
- [\_todo/architecture-patterns/hexagonal-ports-adapters/](./_todo/architecture-patterns/hexagonal-ports-adapters/) — domain-centric, swappable infra. Prereq: feature-based. App: auth-service. **todo**
- [\_todo/architecture-patterns/clean-architecture/](./_todo/architecture-patterns/clean-architecture/) — layered dependency rule. Prereq: hexagonal. App: —. **todo**
- [\_todo/architecture-patterns/ddd/](./_todo/architecture-patterns/ddd/) — tactical patterns. Prereq: clean. App: —. **todo**
- [\_todo/architecture-patterns/cqrs-event-sourcing/](./_todo/architecture-patterns/cqrs-event-sourcing/) — CQRS + ES. Prereq: ddd + event-driven. App: —. **todo**
- [\_todo/architecture-patterns/service-meshes/](./_todo/architecture-patterns/service-meshes/) — Istio / Linkerd. Prereq: microservices. App: —. **todo**

### Auth & Security

- [\_todo/auth-security/input-validation/](./_todo/auth-security/input-validation/) — Zod at boundaries. Prereq: express. App: shop-mvc-express. **partial**
- [\_todo/auth-security/sessions/](./_todo/auth-security/sessions/) — server-side session state. Prereq: express. App: shop-mvc-express. **todo**
- [\_todo/auth-security/jwt/](./_todo/auth-security/jwt/) — JWT access + refresh. Prereq: sessions. App: auth-service. **todo**
- [\_todo/auth-security/oauth-openid/](./_todo/auth-security/oauth-openid/) — OAuth2 / OIDC. Prereq: jwt. App: auth-service. **todo**
- [\_todo/auth-security/rbac-abac/](./_todo/auth-security/rbac-abac/) — role- and attribute-based authz. Prereq: jwt. App: auth-service. **todo**
- [\_todo/auth-security/rate-limiting/](./_todo/auth-security/rate-limiting/) — token bucket, sliding window. Prereq: —. App: auth-service. **todo**
- [\_todo/auth-security/secret-management/](./_todo/auth-security/secret-management/) — Secrets Manager / SSM. Prereq: aws. App: shop-feature-fastify. **todo**
- [\_todo/auth-security/secure-headers/](./_todo/auth-security/secure-headers/) — Helmet, CSP. Prereq: express. App: shop-mvc-express. **partial**

### Data Storage

- [\_todo/data-storage/relational/postgresql/](./_todo/data-storage/relational/postgresql/) — schema, indexes, tx, queries. Prereq: —. App: shop-mvc-express. **todo**
- [\_todo/data-storage/relational/mysql/](./_todo/data-storage/relational/mysql/) — comparison. Prereq: postgresql. App: —. **todo**
- [\_todo/data-storage/caching/redis/](./_todo/data-storage/caching/redis/) — cache-aside, TTL, pub/sub. Prereq: postgresql. App: shop-feature-fastify, chat-ws. **todo**
- [\_todo/data-storage/caching/cdn-strategies/](./_todo/data-storage/caching/cdn-strategies/) — edge caching. Prereq: redis. App: media-service. **todo**
- [\_todo/data-storage/nosql/dynamodb/](./_todo/data-storage/nosql/dynamodb/) — single-table design. Prereq: —. App: serverless-toolkit. **todo**
- [\_todo/data-storage/nosql/mongodb/](./_todo/data-storage/nosql/mongodb/) — document modeling. Prereq: —. App: —. **todo**
- [\_todo/data-storage/graph-db/](./_todo/data-storage/graph-db/) — Neo4j. Prereq: —. App: —. **todo**
- [\_todo/data-storage/time-series/](./_todo/data-storage/time-series/) — Timescale / Influx. Prereq: postgresql. App: —. **todo**

### Async Processing

- [\_todo/async-processing/event-driven/](./_todo/async-processing/event-driven/) — domain vs integration events. Prereq: —. App: orders-event-driven. **todo**
- [\_todo/async-processing/job-queues-bullmq/](./_todo/async-processing/job-queues-bullmq/) — BullMQ worker + retries. Prereq: redis. App: jobs-workflows. **todo**
- [\_todo/async-processing/schedule-cron/](./_todo/async-processing/schedule-cron/) — cron / EventBridge. Prereq: —. App: serverless-toolkit. **todo**

### Microservices

- [\_todo/microservices/api-gateway/](./_todo/microservices/api-gateway/) — BFF, gateway patterns. Prereq: rest. App: bff-gateway. **todo**
- [\_todo/microservices/event-bus-kafka/](./_todo/microservices/event-bus-kafka/) — Kafka / SNS+SQS. Prereq: event-driven. App: —. **todo**
- [\_todo/microservices/idempotency-retries/](./_todo/microservices/idempotency-retries/) — idempotency keys, DLQ, retries. Prereq: event-driven. App: orders-event-driven. **todo**
- [\_todo/microservices/saga-pattern/](./_todo/microservices/saga-pattern/) — orchestration vs choreography. Prereq: idempotency. App: orders-event-driven. **todo**
- [\_todo/microservices/service-discovery/](./_todo/microservices/service-discovery/) — DNS, registry. Prereq: microservices. App: —. **todo**

### Cloud Services

- [\_todo/cloud-services/aws/](./_todo/cloud-services/aws/) — ECS Fargate, RDS, ElastiCache, VPC. Prereq: docker. App: shop-feature-fastify. **todo**
- [\_todo/cloud-services/aws/lambda-api-gateway/](./_todo/cloud-services/aws/lambda-api-gateway/) — serverless HTTP. Prereq: aws. App: serverless-toolkit. **todo**
- [\_todo/cloud-services/aws/s3-cloudfront/](./_todo/cloud-services/aws/s3-cloudfront/) — object storage + CDN. Prereq: aws. App: media-service. **todo**
- [\_todo/cloud-services/aws/serverless-framework/](./_todo/cloud-services/aws/serverless-framework/) — SAM / Serverless FW / CDK. Prereq: lambda-api-gateway. App: serverless-toolkit. **todo**
- [\_todo/cloud-services/gcp/](./_todo/cloud-services/gcp/) — comparison. Prereq: aws. App: —. **todo**
- [\_todo/cloud-services/azure/](./_todo/cloud-services/azure/) — comparison. Prereq: aws. App: —. **todo**

### DevOps / CI-CD

- [\_todo/devops-ci-cd/docker/](./_todo/devops-ci-cd/docker/) — multi-stage, compose. Prereq: —. App: shop-mvc-express. **todo**
- [\_todo/devops-ci-cd/github-actions/](./_todo/devops-ci-cd/github-actions/) — CI/CD pipelines. Prereq: docker. App: shop-mvc-express. **partial**
- [\_todo/devops-ci-cd/terraform-iac/](./_todo/devops-ci-cd/terraform-iac/) — CDK / Terraform. Prereq: aws. App: shop-feature-fastify. **todo**
- [\_todo/devops-ci-cd/kubernetes/](./_todo/devops-ci-cd/kubernetes/) — EKS, helm. Prereq: docker. App: —. **todo**
- [\_todo/devops-ci-cd/git-strategies/](./_todo/devops-ci-cd/git-strategies/) — trunk-based, gitflow. Prereq: —. App: —. **todo**

### Deployment Strategies

- [\_todo/deployment-strategies/blue-green/](./_todo/deployment-strategies/blue-green/) — blue-green cutover. Prereq: ecs-fargate. App: —. **todo**
- [\_todo/deployment-strategies/canary/](./_todo/deployment-strategies/canary/) — canary + auto-rollback. Prereq: ecs-fargate. App: —. **todo**
- [\_todo/deployment-strategies/feature-flags/](./_todo/deployment-strategies/feature-flags/) — flag-driven rollout. Prereq: —. App: —. **todo**

### Observability

- [\_todo/observability/logging/](./_todo/observability/logging/) — Pino + request IDs. Prereq: express. App: shop-mvc-express. **todo**
- [\_todo/observability/metrics-prometheus/](./_todo/observability/metrics-prometheus/) — RED/USE, histograms. Prereq: logging. App: shop-feature-fastify. **todo**
- [\_todo/observability/tracing-opentelemetry/](./_todo/observability/tracing-opentelemetry/) — spans, propagation. Prereq: logging. App: shop-feature-fastify. **todo**
- [\_todo/observability/alerting-grafana/](./_todo/observability/alerting-grafana/) — alerts + SLOs. Prereq: metrics. App: shop-feature-fastify. **todo**

### Performance

- [\_todo/performance-optimization/profiling/](./_todo/performance-optimization/profiling/) — --prof, clinic. Prereq: event-loop. App: shop-feature-fastify. **todo**
- [\_todo/performance-optimization/benchmarking-autocannon/](./_todo/performance-optimization/benchmarking-autocannon/) — autocannon, k6. Prereq: —. App: shop-feature-fastify. **todo**
- [\_todo/performance-optimization/memory-leaks/](./_todo/performance-optimization/memory-leaks/) — heap snapshots. Prereq: profiling. App: —. **todo**
- [\_todo/performance-optimization/scalability-patterns/](./_todo/performance-optimization/scalability-patterns/) — HPA, read replicas, sharding. Prereq: ecs-fargate. App: shop-feature-fastify. **todo**

### Testing & Quality

- [\_todo/testing-quality/unit-testing-jest/](./_todo/testing-quality/unit-testing-jest/) — Vitest/Jest units. Prereq: —. App: all. **todo**
- [\_todo/testing-quality/integration-testing/](./_todo/testing-quality/integration-testing/) — real DB tests. Prereq: unit-testing. App: shop-mvc-express. **todo**
- [\_todo/testing-quality/contract-testing/](./_todo/testing-quality/contract-testing/) — Pact. Prereq: integration. App: shop-feature-fastify ↔ auth-service. **todo**
- [\_todo/testing-quality/mutation-testing/](./_todo/testing-quality/mutation-testing/) — Stryker. Prereq: unit-testing. App: —. **todo**
- [\_todo/testing-quality/static-analysis/](./_todo/testing-quality/static-analysis/) — ESLint typed, Sonar. Prereq: —. App: all. **partial**

### Compliance & Governance

- [\_todo/compliance-governance/threat-modeling/](./_todo/compliance-governance/threat-modeling/) — STRIDE. Prereq: —. App: auth-service. **todo**
- [\_todo/compliance-governance/gdpr/](./_todo/compliance-governance/gdpr/) — data subject rights. Prereq: —. App: shop-feature-fastify. **todo**
- [\_todo/compliance-governance/pci-dss/](./_todo/compliance-governance/pci-dss/) — cardholder scope. Prereq: —. App: orders-event-driven. **todo**

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
