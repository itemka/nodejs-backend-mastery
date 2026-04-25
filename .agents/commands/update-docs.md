# Update Docs Command

Use this as a runnable prompt for documentation updates.

## Run

1. Read `AGENTS.md` and the rules under `.agents/rules/`.
2. Read and follow [.agents/skills/update-docs/SKILL.md](../skills/update-docs/SKILL.md).
3. If AI-agent guidance is in scope, fetch current official docs for the referenced tools during this run and report the sources checked.
4. Update `docs/CURRENT_TASK_CONTEXT.md` with [.agents/skills/current-task-context/SKILL.md](../skills/current-task-context/SKILL.md) after meaningful documentation changes.

## User Input

Use the command arguments or latest user message as the documentation brief. Include target surface, audience, changed behavior, examples, validation, migration notes, rollback notes, and source links when provided.

## Output

- Docs updated.
- What was documented.
- Examples or migration notes.
- Validation/source checked.
- AI-agent best-practice sources checked, when applicable.
- Remaining gaps.
