# Validate Changed Command

Use this as a runnable prompt for scoped validation of the current changed files.

## Run

1. Read `AGENTS.md` and the rules under `.agents/rules/`.
2. Read and follow [.agents/skills/validate/SKILL.md](../skills/validate/SKILL.md).
3. Run `pnpm run validate:changed`.
4. If validation fails, summarize the failing phase and use focused follow-up checks after any fix.
5. Update `docs/CURRENT_TASK_CONTEXT.md` with [.agents/skills/current-task-context/SKILL.md](../skills/current-task-context/SKILL.md) after meaningful investigation or fixes.

## User Input

Use the command arguments or latest user message as validation context. Respect any requested file, workspace, staged-only, or no-fix scope.

## Output

- Validation command.
- Result.
- Failed phase, if any.
- Follow-up checks or remaining risk.
