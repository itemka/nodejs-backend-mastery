# Project Rules

Always-on rules for AI agents working in this repository.

- Work in small, safe steps. Prefer a focused diff that can be reviewed quickly.
- Understand existing code before editing. Inspect nearby files, tests, scripts, and established patterns first.
- Resolve material ambiguity before editing. Use repository evidence first and state any remaining assumptions.
- For non-trivial work, identify the intended outcome and the smallest check that will demonstrate it.
- Choose the least complex approach that meets the request; avoid speculative behavior, configuration, or abstractions.
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

Progress and handoff state for work in flight lives in the file-backed plan itself — see [skills/plan/SKILL.md](../skills/plan/SKILL.md) § _Plan Artifact Policy_ and _Executing a Plan_ (`Status`, `Current step`) — not in a separate session file.
