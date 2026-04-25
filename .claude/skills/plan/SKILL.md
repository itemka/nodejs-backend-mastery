---
name: plan
description: Use to turn a vague or multi-step software task into a clear implementation plan with scope, files, risks, and validation before coding. Direct invocations such as "plan this", "/plan", or "create a plan" create or update a docs/plan-*.md file.
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
