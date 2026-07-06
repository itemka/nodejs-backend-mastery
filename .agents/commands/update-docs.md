# Update Docs Command

Use this as a runnable prompt for documentation updates.

## Run

1. Read `AGENTS.md` and the rules under `.agents/rules/`.
2. Read and follow [.agents/skills/update-docs/SKILL.md](../skills/update-docs/SKILL.md).
3. If the request targets AI-agent guidance, switch to [.agents/skills/maintain-agent-docs/SKILL.md](../skills/maintain-agent-docs/SKILL.md) before editing.
4. When a handoff is useful — work continues across turns, tools, or sessions — update `docs/CURRENT_TASK_CONTEXT.md` per [.agents/skills/current-task-context/SKILL.md](../skills/current-task-context/SKILL.md) (see its `When To Use` / `When Not To Use`).

## User Input

Use the command arguments or latest user message as the documentation brief. Include target surface, audience, changed behavior, examples, validation, migration notes, rollback notes, and source links when provided.

## Output

- Docs updated.
- What was documented.
- Examples or migration notes.
- Validation/source checked.
- Remaining gaps.
