# Prepare PR Command

Use this as a runnable prompt for preparing PR text from the current diff and validation context.

## Run

1. Read `AGENTS.md` and the rules under `.agents/rules/`.
2. Read and follow [.agents/skills/pr-description/SKILL.md](../skills/pr-description/SKILL.md).
3. Use [.agents/skills/pr-description/pr-description-template.md](../skills/pr-description/pr-description-template.md) for the PR shape.
4. Use [.agents/checklists/pr-readiness.md](../checklists/pr-readiness.md) for readiness checks.
5. Do not push, open a PR, or mutate remote state unless the user explicitly asks.

## User Input

Use the command arguments or latest user message as PR-preparation context. Include issue links, target branch, validation, screenshots, migration notes, release notes, and known risks when provided.

## Output

- Title.
- Summary.
- Changes, unless the PR is a small single-concern change.
- Validation when known.
- Risks, rollback, screenshots, examples, migrations, and checklist items when relevant.
