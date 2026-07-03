---
name: deprecation-and-migration
description: Removing or replacing a system, API, feature, or dependency and migrating its consumers onto the replacement, including feature-flag cleanup and dead-code removal. Use when sunsetting legacy code or deciding whether to maintain or retire existing code.
argument-hint: '[system, feature, flag, or dependency to deprecate]'
---

# Deprecation And Migration

Canonical instructions live in `.agents/skills/deprecation-and-migration/SKILL.md`.

When this skill is selected:

1. Read `AGENTS.md`.
2. Read `.agents/README.md` and the rules under `.agents/rules/`.
3. Read `.agents/skills/deprecation-and-migration/SKILL.md`.
4. Follow the `.agents` skill as the source of truth.
5. Do not remove the old path until a proven replacement exists and all consumers have migrated.
