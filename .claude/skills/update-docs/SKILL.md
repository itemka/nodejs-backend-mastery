---
name: update-docs
description: Use when updating README files, API examples, changelogs, migration notes, setup docs, developer workflows, or AI-agent guidance for Codex, Claude Code, Cursor, MCP, skills, agents, commands, hooks, prompts, or checklists.
argument-hint: '[doc surface or change description]'
---

# Update Docs

Canonical instructions live in `.agents/skills/update-docs/SKILL.md`.

When this skill is selected:

1. Read `AGENTS.md`.
2. Read `.agents/README.md` and the rules under `.agents/rules/`.
3. Read `.agents/skills/update-docs/SKILL.md`.
4. Follow the `.agents` skill as the source of truth.
5. Document only behavior that was implemented or verified.
6. For AI-agent docs, run the canonical current-official-docs and recent-change refresh before editing unless the user explicitly says not to browse; search the last 30 days first, then broaden to 90 days only if no useful dated updates are found.
