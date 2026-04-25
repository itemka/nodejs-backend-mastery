# Review Current Diff Command

Use this as a runnable prompt for a read-only review of the current git diff.

## Run

1. Read `AGENTS.md` and the rules under `.agents/rules/`.
2. Read and follow [.agents/skills/code-review/SKILL.md](../skills/code-review/SKILL.md).
3. Load only relevant checklists from [.agents/checklists/](../checklists/).
4. Stay read-only unless the user explicitly asks for edits.

## User Input

Use the command arguments or latest user message as the review focus. Respect staged, unstaged, base branch, file scope, severity, or risk-area instructions.

## Output

- Must fix.
- Should fix.
- Nice to have.
- Test gaps.
- Open questions.
