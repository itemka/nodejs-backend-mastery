# Update Documentation

## Purpose

Document real behavior, workflows, APIs, migrations, and decisions with concise, accurate updates.

## When To Use

- A change affects setup, API usage, configuration, migration steps, examples, or contributor workflow.
- A PR needs docs updated before review.
- Existing docs conflict with current code.
- AI-agent guidance for Codex, Claude Code, Cursor, MCP, skills, agents, commands, prompts, hooks, or checklists may be stale.

## Inputs

- Current diff or implemented behavior.
- Existing docs, README files, examples, commands, and templates.
- Validation output, screenshots, API examples, or migration notes when relevant.
- Current official docs for AI tools, CLIs, cloud services, libraries, or other fast-moving topics.
- Recent official changelogs, release notes, and dated best-practice pages for fast-moving AI-agent guidance.

## Use With

- [update-docs skill](../skills/update-docs/SKILL.md)
- [update-docs command](../commands/update-docs.md)
- [documentation checklist](../checklists/documentation.md)

## Review Or Work Steps

1. Identify the target audience.
2. Inspect the code and existing docs before writing.
3. For AI-agent guidance, fetch current official docs at execution time for the referenced tools. Prefer OpenAI Codex, Claude Code, Cursor, and Agent Skills sources.
4. Also scan recent official changelogs, release notes, and dated best-practice pages. Search the last 30 days first; if that finds no useful dated updates, broaden to the last 90 days and say that the window was expanded.
5. Compare the repo guidance against current and recent best practices for AGENTS.md, skills, subagents, commands, prompts, hooks, MCP, memory/rules, and adapters.
6. Verify current official docs before updating other drift-prone tool, CLI, API, or cloud-service guidance.
7. Update the smallest relevant docs surface, changing `.agents/` first when the guidance is portable.
8. Prefer concrete examples, commands, and file references.
9. Remove stale or conflicting content.
10. Report docs changed, sources checked, recency window used, and any intentional gaps.

## Output Format

- Docs updated.
- Behavior or workflow documented.
- Examples or migration notes added.
- Source or validation checked.
- AI-agent best-practice and recent-change sources checked, when applicable.
- Remaining docs gaps.

## Boundaries

- Do not document behavior that was not implemented or verified.
- Do not include secrets, local paths, private URLs, or environment-specific values.
- Do not rewrite unrelated docs.
