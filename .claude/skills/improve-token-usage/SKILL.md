---
name: improve-token-usage
description: Investigate AI-session context cost and model routing, then produce a prioritized token-usage improvement plan without lowering answer quality. Use when asked to reduce token usage, shrink always-loaded context, improve context loading, select a model class for task complexity, optimize model selection, or run /improve-token-usage.
argument-hint: '[optional output path or focus]'
---

# Improve Token Usage

Canonical instructions live in `.agents/skills/improve-token-usage/SKILL.md`.

When this skill is selected:

1. Read `AGENTS.md`.
2. Read `.agents/README.md` and the rules under `.agents/rules/`.
3. Read `.agents/skills/improve-token-usage/SKILL.md`.
4. Follow the `.agents` skill as the source of truth.
5. Investigation and planning only — do not edit source, config, or instruction files.
