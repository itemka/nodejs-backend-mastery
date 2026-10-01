# Interview Lab

A small NestJS workspace for backend interview experiments. One lab proves one
concept with the minimum executable code. Finish when you can explain the result,
the failure case, and a production trade-off.

Your Notion interview sprint chooses what to study. This workspace holds runnable
evidence. Use Orders/Checkout
when a domain helps; runtime, SQL and AWS experiments can stand alone.

## Start here

Prerequisites: the repository's Node 24 and pnpm 10.33.0. Docker is needed only for
container/data labs; an AWS account is needed only for live AWS exercises.

From the repository root:

```bash
pnpm install --frozen-lockfile
cp workspaces/apps/interview-lab/.env.example workspaces/apps/interview-lab/.env
pnpm --filter interview-lab dev
```

Copy the example only on first setup; preserve an existing `.env`.
In another terminal:

```bash
curl http://localhost:3100/health
pnpm --filter interview-lab test
```

Expected HTTP response: `200` with `{"status":"ok"}`. Trace the request through
`main.ts` → `AppModule` → `HealthController` → injected `HealthService`.
`/health` reports process liveness. It does not check database readiness.

## What is already implemented

- NestJS with its Express adapter, ESM and strict TypeScript.
- A module, controller, injectable provider, `GET /health`, validated environment,
  JSON startup logs, and shutdown hooks.
- Vitest with SWC decorator metadata and HTTP tests through Supertest.
- A production container and optional local PostgreSQL/Redis services.

Add database clients, DTO validation, auth, queues and their tests when you study
them. The bootstrap does not implement those exercises or provision AWS resources.

## Commands

Run these from the repository root:

| Command                                                  | Purpose                                                       |
| -------------------------------------------------------- | ------------------------------------------------------------- |
| `pnpm --filter interview-lab dev`                        | Compile with Nest's TypeScript builder and restart on changes |
| `pnpm --filter interview-lab build`                      | Compile the app to `dist/`                                    |
| `pnpm --filter interview-lab start`                      | Run the compiled app                                          |
| `pnpm --filter interview-lab test`                       | Run unit and HTTP tests without Docker/AWS                    |
| `pnpm --filter interview-lab test:watch`                 | Watch tests during a lab                                      |
| `pnpm --filter interview-lab typecheck`                  | Check source, tests and test configuration                    |
| `pnpm --filter interview-lab lint`                       | Apply the shared repository lint rules                        |
| `pnpm --filter interview-lab lab src/labs/event-loop.ts` | Run a standalone experiment after creating that file          |
| `pnpm --filter interview-lab infra:up`                   | Start PostgreSQL and Redis and wait for health checks         |
| `pnpm --filter interview-lab infra:down`                 | Stop local data services while keeping PostgreSQL's volume    |
| `pnpm --filter interview-lab container:up`               | Build and start only the API container                        |

The `lab` command uses `tsx` for plain Node experiments. Use `dev` for Nest code:
Nest needs decorator metadata, which plain `tsx` does not emit. Vitest uses SWC
for the same reason. Keep classes used for constructor injection or DTO metadata
as runtime imports; interfaces and `import type` disappear at runtime.

## Add one experiment

Create the folder only when needed:

- **Runtime:** `src/labs/event-loop.ts`; predict output, run it, explain the order.
- **HTTP:** `src/labs/idempotency/` with a Nest module, controller, service and a
  behavior test. Register the module in `AppModule`. Use `/labs/idempotency/orders`.
- **SQL:** `labs/transactions/experiment.sql`; run two SQL sessions and observe a
  lock, rollback or conflict. No HTTP layer is required.
- **AWS:** `labs/aws/<concept>/` for a tiny handler or template once needed. Keep
  credentials and account-specific output outside git.

Add only the dependencies that the current experiment needs. Prefer the native
database client while learning SQL, transactions and pooling; learn an ORM later
if an interview requires it. Do not create a general repository abstraction first.

Each experiment needs at most a short note:

```markdown
# Concept

- Question: what am I proving?
- Run: exact command and prerequisites.
- Observe: expected result and one intentional failure/retry.
- Explain: why it happens and one production limitation.
- Cleanup: resources/data created by this experiment.
```

For idempotency, sequential retries are the first check. Also try concurrent
requests with the same key and reject a reused key with a different payload.
An in-memory Map can illustrate the idea; persistence and an atomic uniqueness
constraint are needed to discuss process restarts and multiple instances honestly.

## NestJS learning order

1. **Building blocks:** module imports/exports, controllers, decorators, providers,
   dependency injection, singleton scope and configuration. Explain the health flow.
2. **One request:** add a tiny route with a DTO and validation; deliberately send
   invalid input. Learn middleware, guards, pipes, interceptors and exception filters
   by identifying where each belongs. Add `class-validator`/`class-transformer`
   only when choosing Nest's `ValidationPipe` for that lab.
3. **Boundaries and testing:** custom provider tokens, `useValue`/`useFactory`,
   `TestingModule`, overriding a dependency and HTTP behavior tests.
4. **Feature map:** recognize Swagger/OpenAPI, database integrations, caching,
   queues, scheduling, WebSockets, GraphQL and microservice transports. Implement
   only the feature connected to the current backend topic.

Do not equate using a Nest guard with having solved authentication. Learn the
token/session lifecycle and authorization rules underneath it.

## Study loop and stop rule

Choose one narrow topic → learn → inspect an example → explain without notes →
run a tiny lab when useful → answer questions without hints → record weak points.
For unfamiliar SQL concurrency, Docker and AWS deployment, execute the planned
exercise even if the explanation sounds clear. Reading code is not execution.

Allow 20–40 minutes for an ordinary micro-lab; AWS setup/deployment can take longer.
Split the study day if necessary. Record a concrete next step instead of polishing.
Keep interview gaps in Notion; put only execution notes and code-linked answers here.
Update a roadmap topic only for the slice actually learned, using its existing
status rules. A generated scaffold does not make NestJS, Docker or AWS "done".

Next: [Docker exercises](docs/docker.md) and [AWS practice path](docs/aws.md).

Primary references: [Nest fundamentals](https://docs.nestjs.com/first-steps),
[request lifecycle](https://docs.nestjs.com/faq/request-lifecycle),
[testing](https://docs.nestjs.com/fundamentals/testing),
[Vitest + SWC](https://docs.nestjs.com/recipes/swc#vitest).
