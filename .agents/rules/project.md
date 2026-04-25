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

## Current Task Context Rule

After every meaningful codebase change, investigation, debugging session, review, or implementation step, update [docs/CURRENT_TASK_CONTEXT.md](../../docs/CURRENT_TASK_CONTEXT.md).

Keep it concise. Record what changed, why, files touched, validation run, risks, and next steps. Do not include secrets, long logs, or full source code.
