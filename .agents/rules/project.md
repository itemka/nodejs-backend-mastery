# Project Rules

Always-on rules for AI agents working in this repository.

- Work in small, safe steps. Prefer a focused diff that can be reviewed quickly.
- Understand existing code before editing. Inspect nearby files, tests, scripts, and established patterns first.
- Follow the current architecture and style. Do not invent a new layering pattern when the repo already has one.
- Prefer TypeScript strictness and strong typing. Model data with precise types, schemas, and narrow interfaces.
- Avoid `any` unless there is a clear reason. If `any` is necessary, keep it local and explain why.
- Validate external input at system boundaries such as HTTP handlers, CLI inputs, env loading, job payloads, and message consumers.
- Use the existing error-handling and logging style. Do not leak internal errors, tokens, credentials, or private data.
- Do not introduce secrets, tokens, API keys, or local machine paths into committed files.
- Do not run destructive commands or irreversible migrations unless the user explicitly asks and the risk is understood.
- Add or update tests for meaningful behavior changes. If tests are not practical, explain the gap.
- Run the smallest relevant validation first, then broader checks when safe.
- Report what changed, how it was validated, and anything that remains unverified.

## AI-Agent Guidance Rule

Treat `.agents/skills/` as the canonical home for reusable workflows. Keep `.agents/commands/`, `.agents/agents/`, `.claude/`, `.cursor/`, `.codex/`, `.github/`, and other tool-specific adapters thin; they should route to skills or rules instead of duplicating full workflows.

When useful guidance appears in a command, prompt template, README-only folder, or tool adapter, move the durable workflow content into the related skill first, then make the adapter point to it. Do not keep reference-only folders such as `.agents/hooks/`, `.agents/mcp/`, `.agents/prompts/`, or `.agents/commits/`; create them only for concrete reusable assets that cannot live cleanly in skills, commands, agents, or checklists.

When adding or renaming a skill, keep the folder name equal to frontmatter `name`, update `.agents/README.md`, and add or update any required tool-specific thin adapters, such as `.claude/skills/<name>/SKILL.md`.

## Current Task Context Rule

`docs/CURRENT_TASK_CONTEXT.md` is a **session-only file** — it is intentionally not committed to the repository. Create it if it does not exist; do not treat a missing file as an error or skip updating it because it is absent.

After every meaningful codebase change, investigation, debugging session, review, or implementation step, create or update [docs/CURRENT_TASK_CONTEXT.md](../../docs/CURRENT_TASK_CONTEXT.md)

Keep the live `Current Focus` concise. Append meaningful implementation, decision, validation, blocker, rollback, and handoff events to the timestamped logs using local ISO 8601 minute precision with timezone offset, for example `2026-04-25T14:32+02:00`.

Do not delete or rewrite historical log entries just because newer work supersedes them; append a correction or follow-up entry instead. Record what changed, why, files touched, validation run, risks, and next steps. Do not include secrets, long logs, or full source code.
