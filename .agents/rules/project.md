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

For AI-agent docs design rules (skills are canonical, adapters are thin, role specs link from skills), see [.agents/README.md](../README.md).

## Current Task Context Rule

`docs/CURRENT_TASK_CONTEXT.md` is a **session-only file** — it is intentionally not committed to the repository. Create it if it does not exist; do not treat a missing file as an error or skip updating it because it is absent.

After every meaningful codebase change, investigation, debugging session, review, or implementation step, create or update [docs/CURRENT_TASK_CONTEXT.md](../../docs/CURRENT_TASK_CONTEXT.md) using [skills/current-task-context/SKILL.md](../skills/current-task-context/SKILL.md).

Keep `Current Focus` concise. Append timestamped entries to `Implementation Log`, `Decision Log`, and `Validation Log` using local ISO 8601 minute precision with timezone offset (for example `2026-04-25T14:32+02:00`). Do not delete or rewrite historical log entries; append a correction or follow-up entry instead. Record what changed, why, files touched, validation run, risks, and next steps. Do not include secrets, long logs, or full source code.
