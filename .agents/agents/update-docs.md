# Update Documentation

## Purpose

Document real behavior, workflows, APIs, migrations, and decisions with concise, accurate updates.

## When To Load

- A change affects setup, API usage, configuration, migration steps, examples, or contributor workflow.
- A PR needs docs updated before review.
- Existing docs conflict with current code.
- AI-agent guidance for Codex, Claude Code, Cursor, MCP, skills, agents, commands, prompts, hooks, or checklists may be stale.

## Pairs With

- [update-docs skill](../skills/update-docs/SKILL.md) — canonical workflow, including the `Freshness Window`, `AI-Agent Docs Layout`, and `AI-Agent Docs Review` for AI-agent docs.
- [documentation checklist](../checklists/documentation.md)
- [task-analyst role](./task-analyst.md) — load when the docs request is broad or missing audience.
- [code-review role](./code-review.md) — load when docs are part of a broader review.

## Output Contributions

- Docs updated and behavior documented.
- Examples, migration notes, validation, sources checked.
- Recency window used for AI-agent guidance updates.
- AI-agent structural review findings and structure recommendation when AI-agent guidance is in scope.
- Remaining docs gaps.

## Boundaries

- Do not document behavior that was not implemented or verified.
- Do not include secrets, private URLs, personal paths, or environment-specific values.
- Do not rewrite unrelated docs.
