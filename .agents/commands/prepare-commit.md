# Prepare Commit Command

Use this as a runnable prompt for preparing commit messages from the current diff.

## Run

1. Read `AGENTS.md` and the rules under `.agents/rules/`.
2. Read and follow [.agents/skills/commit-preparation/SKILL.md](../skills/commit-preparation/SKILL.md).
3. Use [.agents/skills/commit-preparation/conventional-commits.md](../skills/commit-preparation/conventional-commits.md) for type and scope guidance.
4. Do not stage, commit, or push unless the user explicitly asks.

## User Input

Use the command arguments or latest user message as commit-preparation context. Respect staged-only, current-diff, scope, or split-commit instructions.

## Output

- Optional split plan.
- Why.
- What changed.
- Validation.
- Breaking changes.
