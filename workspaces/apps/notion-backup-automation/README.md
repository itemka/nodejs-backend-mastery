# notion-backup-automation

A backup agent that will request the official Notion workspace export every month and store
the ZIP in Google Drive. It runs as Vercel Functions.

**Status:** scaffold. The only function is `GET /api/health`.

## Layout

| Path                | Purpose                                                                       |
| ------------------- | ----------------------------------------------------------------------------- |
| `api/`              | Vercel function entry points (Web `Request` → `Response`). No business logic. |
| `src/config/env.ts` | Zod env schemas, one subset per function.                                     |
| `tests/`            | Vitest. Tests never touch the network or real credentials.                    |
| `vercel.json`       | Region and per-function limits.                                               |
| `.env.example`      | Template for the untracked `.env.local`.                                      |

## Commands

```sh
pnpm --filter notion-backup-automation typecheck
pnpm --filter notion-backup-automation test
pnpm --filter notion-backup-automation lint
```

Local configuration lives in `.env.local`: copy `.env.example`, run `chmod 600 .env.local` and
fill in the values. Git ignores `.env.local` and every other `.env.*` file except the example.

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
