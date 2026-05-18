# Debug Command

Use this as a runnable prompt for debugging failures in this repo.

## Run

1. Read `AGENTS.md` and the rules under `.agents/rules/`.
2. Read and follow [.agents/skills/debug/SKILL.md](../skills/debug/SKILL.md).
3. Use [.agents/skills/validate/SKILL.md](../skills/validate/SKILL.md) for focused verification.
4. When a handoff is useful — work continues across turns, tools, or sessions — update `docs/CURRENT_TASK_CONTEXT.md` per [.agents/skills/current-task-context/SKILL.md](../skills/current-task-context/SKILL.md) (see its `When To Use` / `When Not To Use`).

## User Input

Use the command arguments or latest user message as the debugging brief. Look for the failing command, error output, reproduction steps, recent changes, and constraints.

## Output

- Root cause.
- Fix or recommended fix.
- Regression coverage.
- Validation.
- Remaining risk.
