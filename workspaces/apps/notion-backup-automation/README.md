# notion-backup-automation

A backup agent that will request the official Notion workspace export every month and store
the ZIP in Google Drive. It runs as Vercel Functions.

**Status:** domain and persistent state (Phase 1). The only function is still `GET /api/health`.

## Layout

| Path                        | Purpose                                                                                                                           |
| --------------------------- | --------------------------------------------------------------------------------------------------------------------------------- |
| `api/`                      | Vercel function entry points (Web `Request` → `Response`). No business logic.                                                     |
| `src/config/env.ts`         | Zod env schemas, one subset per function. Errors name the variables, never their values.                                          |
| `src/domain/`               | The job schema, statuses, transitions and lifecycle rules, schedule and retry policies, periods, naming, the error catalog. Pure. |
| `src/application/ports.ts`  | The ports the adapters implement (`JobRepository`, `SecretStore`, `HealthStore`).                                                 |
| `src/adapters/persistence/` | Upstash Redis adapters with Lua scripts (`lua/*.lua`), and the in-memory job repository.                                          |
| `src/shared/`               | The redacting JSON-line logger, envelope crypto (AES-256-GCM), the `.env.local` writer, clock, IDs.                               |
| `tests/`                    | Vitest. `tests/contract/` holds the repository contract; `tests/live/` the opt-in live suite.                                     |
| `vercel.json`               | Region and per-function limits.                                                                                                   |
| `.env.example`              | Template for the untracked `.env.local`.                                                                                          |

## Commands

```sh
pnpm --filter notion-backup-automation typecheck
pnpm --filter notion-backup-automation test
pnpm --filter notion-backup-automation lint
NBA_LIVE_REDIS=1 pnpm --filter notion-backup-automation test:live
```

`test` never touches the network, a browser or real credentials. `test:live` runs the repository
contract, the secret store and the health store against real Redis, using
`UPSTASH_REDIS_REST_URL` and `UPSTASH_REDIS_REST_TOKEN` from `.env.local`. It writes only under
`{nba:test}:live-<run>:` and deletes those keys afterwards. Without `NBA_LIVE_REDIS=1` it skips.
It also runs against a local Redis behind
[serverless-redis-http](https://github.com/hiett/serverless-redis-http), which accepts plain
`http://` URLs.

Local configuration lives in `.env.local`: copy `.env.example`, run `chmod 600 .env.local` and
fill in the values. Git ignores `.env.local` and every other `.env.*` file except the example.

## State In Redis

Every key starts with `{nba:<APP_ENV>}:`, so `prod`, `dev` and `test` share the
`notion-backup-state` database without overlap. The braces are a hash tag that keeps one
environment's keys in one slot for the Lua scripts.

| Key                           | Content                                                               |
| ----------------------------- | --------------------------------------------------------------------- |
| `job:<jobId>`                 | Hash `{ v, data }`: the compare-and-set version and the job JSON      |
| `jobs`                        | Sorted set of job IDs by `createdAt`                                  |
| `active`                      | The one active job ID; cleared when the job reaches a terminal status |
| `lease:<jobId>`               | The worker holding the job (`SET NX PX`)                              |
| `events:<jobId>`              | The newest 200 sanitized events                                       |
| `email:<messageId>`           | The job that consumed this export email                               |
| `secret:notion-storage-state` | The AES-256-GCM envelope of the Notion session                        |
| `health`                      | The last result of each health probe                                  |

A normal job's ID is its period (`2026-10`), so `job:<period>` is also the
one-normal-job-per-period guard. A forced job is `<period>-r<N>`.

## Health Check

`GET /api/health` → `200 {"ok":true,"version":"<short commit SHA>"}` with `Cache-Control: no-store`.
The version is `unknown` outside a Vercel Git deployment. The endpoint is public, so it returns
nothing else.

## Vercel Project

The project imports this repository from GitHub:

| Setting                                                              | Value                                        |
| -------------------------------------------------------------------- | -------------------------------------------- |
| Framework Preset                                                     | Other                                        |
| Root Directory                                                       | `workspaces/apps/notion-backup-automation`   |
| Include source files outside of the Root Directory in the Build Step | On                                           |
| Build, install and output settings                                   | Defaults                                     |
| Node.js version                                                      | 24.x (pinned by `engines` in `package.json`) |
| Function region                                                      | `fra1` (from `vercel.json`)                  |
| Environment variables                                                | None yet                                     |

Vercel compiles each `api/*.ts` file and resolves imports with plain Node.js rules; it does
not bundle. So the functions must not import the repo's `@workspaces/packages/*` packages:
Node.js cannot resolve a package name with three segments (`ERR_UNSUPPORTED_DIR_IMPORT`), and
the sibling apps only use them through esbuild bundles or `tsx`. Import npm packages, or code
inside this app, instead.
