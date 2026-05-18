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

`docs/CURRENT_TASK_CONTEXT.md` is a **session-only, gitignored local handoff file** — not a permanent audit trail and not part of any commit.

Keep a compact handoff in [docs/CURRENT_TASK_CONTEXT.md](../../docs/CURRENT_TASK_CONTEXT.md) when work will continue across turns, tools, or sessions. Skip it for trivial or fully reverted edits, or when the next action is already obvious from the current diff. Create the file when needed; do not treat a missing file as an error.

Use [skills/current-task-context/SKILL.md](../skills/current-task-context/SKILL.md) for the file shape, update rules, and the `Activity Log` compaction rule (~120 lines). Use local ISO 8601 minute precision with timezone offset (for example `2026-05-18T16:32+02:00`) for log headings. Record what changed, why, files touched, validation run, risks, and next steps. Do not include secrets, long terminal logs, or full source code.
