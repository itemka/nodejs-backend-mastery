---
name: maintain-agent-docs
description: Maintains AI-agent documentation and adapters for .agents/, AGENTS.md, CLAUDE.md, .claude/, .codex/, .cursor/, and .github/. Use when creating, updating, auditing, or freshness-checking skills, commands, agents, rules, hooks, MCP notes, prompts, checklists, or tool adapters.
argument-hint: '[agent-doc surface or change description]'
---

# Maintain Agent Docs

Canonical instructions live in `.agents/skills/maintain-agent-docs/SKILL.md`.

When this skill is selected:

1. Read `AGENTS.md`.
2. Read `.agents/README.md` and the rules under `.agents/rules/`.
3. Read `.agents/skills/maintain-agent-docs/SKILL.md`.
4. Follow the `.agents` skill as the source of truth, including its freshness window and structural review.
5. Keep Claude-specific files as thin adapters into `.agents/`.
