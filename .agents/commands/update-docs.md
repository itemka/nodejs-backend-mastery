# Update Docs

## Goal

Update the smallest relevant documentation for a code, behavior, setup, API, migration, or workflow change.

## Context To Provide

- What changed and why.
- Files, modules, routes, commands, or configs involved.
- Audience: user, contributor, operator, reviewer, or maintainer.
- Validation, examples, screenshots, migration notes, or rollback notes when relevant.

## Required Steps

1. Inspect the changed code and existing docs.
2. Identify the doc surface that should change.
3. If the task touches AI-agent guidance, fetch current official docs at execution time for Codex, Claude Code, Cursor, Agent Skills, MCP, or any referenced tool before editing.
4. Compare current best practices with `.agents/` and any tool adapters; update `.agents/` first when guidance is portable.
5. For other AI tools, CLIs, cloud services, libraries, or fast-moving topics, verify current official docs.
6. Update only the relevant sections.
7. Add concrete examples or commands when useful.
8. Remove stale or conflicting statements.
9. Update `docs/CURRENT_TASK_CONTEXT.md` for meaningful documentation handoffs.
10. Report docs changed, sources checked, and any gaps left open.

## Output Format

- Docs updated.
- What was documented.
- Examples or migration notes.
- Validation/source checked.
- AI-agent best-practice sources checked, when applicable.
- Remaining gaps.

## Safety Notes

Do not include secrets, local machine paths, private URLs, or claims that were not verified.
