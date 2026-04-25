# Repo Map

Project-specific orientation for AI agents. Keep this file easy to edit when copied into another project.

## Shape

- Package manager: `pnpm`.
- Runtime: Node.js `>=22`.
- Monorepo workspaces are declared in `pnpm-workspace.yaml`.
- Apps live under `workspaces/apps/*`.
- Shared packages live under `workspaces/packages/*`.
- Docs live under `docs/*`.
- Shared AI-agent material lives under `.agents/*`.
- Reusable AI workflows live under `.agents/skills/*/SKILL.md`.
- `.agents/commands/*` are thin runnable prompts that load skills.
- `.agents/agents/*` are optional portable role definitions that should point to skills and checklists instead of restating workflows.
- Skills should link useful `.agents/agents/*` files in a short `Related Role Specs` section so role guidance is discoverable on demand.
- Tool-specific adapters live under `.claude/`, `.codex/`, `.cursor/`, or `.github/` when needed and should stay thin.

## Apps

- `workspaces/apps/shop-mvc-express`: Express backend app.
- `workspaces/apps/local-llm-playground`: Express backend with a Vite/React client and shared schemas.
- README-only app scaffolds are not production-ready and are not expected to build unless their package config says otherwise.
- Anything under `_todo`, scratch, or placeholder areas should not be treated as production-ready.

## Packages

- `workspaces/packages/config`: shared env/schema config helpers.
- `workspaces/packages/errors`: shared error types.
- Prefer importing shared packages by package name when the package exposes one.

## Commands And Checks

- Root scripts are defined in `package.json`.
- Common root checks: `pnpm run lint`, `pnpm run format:check`, `pnpm run typecheck`, `pnpm run test`, `pnpm run build`.
- Use pnpm filters for package-specific work, for example `pnpm --filter local-llm-playground test`.
- `local-llm-playground` uses Vitest and has separate backend/client typecheck and build scripts.
- `shop-mvc-express` has build and typecheck scripts but no test script in its package file.

## Config And CI

- TypeScript base config: `tsconfig.base.json`.
- ESLint config: `eslint.config.mjs`.
- CI workflow: `.github/workflows/ci.yml`.
- CI runs lint, format check, typecheck, tests, app builds for changed apps, audit, secret scanning, and SonarCloud when available.
- Root files such as `AGENTS.md` and `CLAUDE.md` should stay thin and point into `.agents/`.
- When `.agents/skills/` changes, keep `.agents/README.md` and tool-specific skill adapters in sync.
