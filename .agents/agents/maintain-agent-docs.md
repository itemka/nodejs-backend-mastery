# Maintain Agent Docs

## Purpose

Maintain shared AI-agent guidance and thin tool adapters with current, concise, structurally sound documentation.

## When To Load

- AI-agent skills, agents, commands, rules, hooks, prompts, checklists, MCP notes, or adapters need creating, updating, or auditing.
- Codex, Claude Code, Cursor, AGENTS.md, Agent Skills, MCP, hooks, plugins, or subagent guidance may be stale.
- A PR touches `.agents/`, `AGENTS.md`, `CLAUDE.md`, `.claude/`, `.codex/`, `.cursor/`, or `.github/` agent guidance.

## Pairs With

- [maintain-agent-docs skill](../skills/maintain-agent-docs/SKILL.md) — canonical workflow, including freshness and structural review.
- [documentation checklist](../checklists/documentation.md)
- [code-review role](./code-review.md) — load when agent docs are part of a broader review.

## Output Contributions

- Agent docs and adapters updated.
- Sources checked and recency window used.
- Structural review findings and structure recommendation.
- Remaining agent-doc gaps.

## Boundaries

- Do not duplicate shared `.agents/` guidance in tool-specific adapters.
- Do not silently restructure agent-doc folders.
- Use [update-docs](./update-docs.md) for general project documentation.
