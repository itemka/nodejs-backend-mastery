# Repo Map

Project-specific orientation for AI agents. Keep this file easy to edit when copied into another project.

## Shape

- Package manager: `pnpm`.
- Runtime: Node.js `>=24`.
- Monorepo workspaces are declared in `pnpm-workspace.yaml`.
- Apps live under `workspaces/apps/*`.
- AI engineering learning examples live under `workspaces/ai-engineering/*`.
- Shared packages live under `workspaces/packages/*`.
- Docs live under `docs/*`. Architecture diagrams: `docs/architecture/`
  (Structurizr C4 model) and `docs/features/` (Mermaid workflow diagrams);
  conventions in `docs/architecture/README.md`.
- Shared AI-agent material lives under `.agents/*`. Tool-specific adapters live under `.claude/`, `.codex/`, `.cursor/`, or `.github/` and should stay thin (see [.agents/README.md](../README.md) for design rules).

## Context Loading Policy

Use the smallest context set that can answer the task safely.

- **Always loaded:** repo entry rules, safety rules, this repo shape, current
  task, and changed-file summary.
- **Loaded on demand:** task-specific skills, target source files, nearby tests,
  package manifests, relevant docs, and imported shared packages.
- **Avoid unless explicitly needed:** historical handoff logs, generated output,
  `docs/_todo/**`, dependency folders, binary or sample assets, broad roadmap
  docs, and secret-bearing local config.

For code tasks, inspect the target workspace, nearby tests, package manifest,
and imported shared packages before broad docs. Prefer `git ls-files`,
`git status --short <path>`, and focused `rg --files <path>` over broad `find`
or unscoped status output.

Load avoid-tier sources only when the task explicitly targets them. For Claude,
use a subagent for broad independent research or verbose output, especially when
more than a few file reads are needed. For Codex, keep broad shell output short
and path-scoped because raw output stays in the conversation transcript.

## Apps

- `workspaces/apps/shop-mvc-express`: Express backend app.
- `workspaces/apps/local-llm-playground`: Express backend with a Vite/React client and shared schemas.
- README-only app scaffolds are not production-ready and are not expected to build unless their package config says otherwise.
- Anything under `_todo`, scratch, or placeholder areas should not be treated as production-ready.

## AI Engineering

- `workspaces/ai-engineering/llm-chat`: interactive LLM chat CLI built on `@workspaces/packages/llm-client`.
- `workspaces/ai-engineering/mcp-chat`: document-focused MCP server + CLI MCP client/chatbot using the MCP TypeScript SDK V2 alpha. In-memory documents, streaming chat, `@doc_name` mentions, MCP-prompt slash commands.
- `workspaces/ai-engineering/prompt-eval-lab`: automated prompt-evaluation CLI (dataset → render → run → grade) on top of `@workspaces/packages/llm-client`.
- `workspaces/ai-engineering/rag-pipeline`: Express RAG retrieval service with VoyageAI embeddings, in-memory vector index, BM25 lexical index, and hybrid RRF retrieval. Consumed by `llm-chat` over HTTP through the optional `search_docs` tool.

## Packages

- `workspaces/packages/cli-output`: shared terminal color theme (semantic
  helpers such as `heading`, `success`, `warn`, `error`, `muted`, `accent`,
  `ok`, `fail`, plus a `symbols` map). Imported as `@workspaces/cli-output`.
  Plain ESM JS + hand-written `index.d.ts` (no build step) so it resolves under
  both plain `node` scripts and the TS toolchain; wraps `chalk@^5` and relies on
  its `NO_COLOR`/TTY detection. Use it for human-facing CLI output only — never
  for JSON loggers or machine-consumed streams.
- `workspaces/packages/config`: shared env/schema config helpers.
- `workspaces/packages/errors`: shared error types.
- `workspaces/packages/llm-client`: provider-neutral LLM client with an Anthropic adapter (source-only, no build step; consumed via `tsconfig` `paths` plus a `workspace:*` dep).
- Prefer importing shared packages by package name when the package exposes one.

## Commands And Checks

- Root scripts are defined in `package.json`.
- Common root checks: `pnpm run lint`, `pnpm run format:check`, `pnpm run typecheck`, `pnpm run test`, `pnpm run build`.
- Aggregate gates: `pnpm run validate` (lint + format:check + typecheck + test) and
  `pnpm run validate:all` (adds `check:secrets`, `check:adapters`, and `build`).
  Use `pnpm run validate:changed` for the scoped, hook-driven path.
- Codex sandbox note: `pnpm` is Corepack-backed here. Before running multiple
  `pnpm` checks, make sure `pnpm --version` works in the current execution mode;
  if sandboxed `pnpm` waits then reports `[ERROR] fetch failed`, rerun required
  `pnpm` validation commands with escalation instead of treating it as a repo
  check failure.
- Architecture model checks: `pnpm run arch:validate` and `pnpm run arch:export`
  (Docker-based; see `docs/architecture/README.md`). Not part of `pnpm run validate`.
- Use pnpm filters for package-specific work, for example `pnpm --filter local-llm-playground test`.
- `local-llm-playground` uses Vitest and has separate backend/client typecheck and build scripts.
- `shop-mvc-express` has build and typecheck scripts but no test script in its package file.

## Config And CI

- TypeScript base config: `tsconfig.base.json`.
- ESLint config: `eslint.config.mjs`.
- GitHub workflows: `.github/workflows/ci.yml` and `.github/workflows/claude.yml`.
- CI runs lint, format check, typecheck, tests, app builds for changed apps, audit, secret scanning, and SonarCloud when available.
- When `.agents/skills/` changes, keep [.agents/README.md](../README.md) and tool-specific skill adapters in sync.
