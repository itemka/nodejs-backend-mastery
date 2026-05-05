---
name: plan
description: Implementation planning for vague or multi-step software tasks. Use when asked to plan, /plan, or create a docs/plan-*.md file with scope, files, risks, and validation.
argument-hint: '[task brief]'
---

# Plan

Canonical instructions live in `.agents/skills/plan/SKILL.md`.

When this skill is selected:

1. Read `AGENTS.md`.
2. Read `.agents/README.md` and the rules under `.agents/rules/`.
3. Read `.agents/skills/plan/SKILL.md`.
4. Follow the `.agents` skill as the source of truth.
5. Treat direct skill invocation as a file-backed plan request unless the user explicitly says not to create a file.
