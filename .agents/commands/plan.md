# Plan Command

Use this as a runnable prompt for explicit planning requests.

## Run

1. Read `AGENTS.md` and the rules under `.agents/rules/`.
2. Read and follow [.agents/skills/plan/SKILL.md](../skills/plan/SKILL.md).
3. Because this command is explicit planning, create or update `docs/plan-<short-task-goal>.md` unless the user explicitly says not to create a file.
4. Do not edit implementation files unless the user explicitly asks for implementation.

## User Input

Use the command arguments or latest user message as the planning brief. Include relevant files, errors, issue links, acceptance criteria, constraints, and risk notes.

## Output

- Goal.
- Context found.
- Assumptions.
- Plan.
- Validation.
- Risks.
