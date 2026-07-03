---
name: update-docs
description: Updates general project documentation for READMEs, API examples, changelogs, migration notes, setup docs, and developer workflows. Use when non-agent docs need to match implemented behavior.
metadata:
  created: '2026-04-25'
  status: 'baseline'
  portability: 'cross-tool'
  last-reviewed: '2026-07-03'
---

# Update Docs

## Purpose

Keep general project documentation accurate, concise, and tied to real code behavior.

## When To Use

- A change affects user-facing behavior, API contracts, setup, config, migrations, or developer workflow.
- The user asks to document a feature, bug fix, architecture decision, or operational note.
- Existing READMEs, docs, examples, changelogs, setup notes, or developer workflows are stale or incomplete.

## When Not To Use

- The task has no user-facing, operational, setup, API, or contributor-facing documentation impact.
- The user asked for code-only work and docs would be speculative.
- The change touches AI-agent guidance, skills, commands, agents, rules, hooks, MCP notes, prompts, checklists, or tool adapters; use [maintain-agent-docs](../maintain-agent-docs/SKILL.md) instead.

## Inputs

- Current diff or implemented change.
- Existing README, docs, examples, API notes, migration notes, changelogs, or templates.
- Validation commands, migration notes, screenshots, or examples when relevant.

## Related Role Specs

- [update-docs](../../agents/update-docs.md): load for role-shaped documentation review or tool-native docs adapter behavior.
- [task-analyst](../../agents/task-analyst.md): load when the documentation request is broad or missing audience, scope, or acceptance criteria.
- [code-review](../../agents/code-review.md): load when docs are part of a broader diff review.

## Surface Routing

- Product, setup, API, and learning docs belong under `docs/` or the nearest package/app README.
- Repo workflow docs belong in the smallest relevant contributor-facing surface.
- AI-agent docs belong in `.agents/` and are maintained through [maintain-agent-docs](../maintain-agent-docs/SKILL.md).

## Workflow

1. Inspect the changed code and nearby docs before editing.
2. Identify the audience: user, contributor, operator, reviewer, or future maintainer.
3. Identify the documentation surface and read the index that lists it, such as a docs index or nearby README.
4. Prefer editing an existing file. Create a new file only when no existing file fits.
5. Update the smallest relevant doc surface and keep headings, tone, and length consistent.
6. Keep indexes and relative links in sync.
7. Prefer concrete examples over generic explanation.
8. Include setup, validation, migration, rollback, or API examples when they are part of the change.
9. Preserve existing docs shapes unless the user asked to restructure them.
10. Remove or correct stale statements that conflict with the new behavior.
11. Report changed docs, source or validation checked, and any docs intentionally left untouched.

## Output Format

- Docs updated.
- Behavior or workflow documented.
- Examples or migration notes added.
- Validation or source checked.
- Remaining documentation gaps.

## Safety Rules

- Do not document behavior that was not implemented or verified.
- Do not include secrets, private URLs, personal paths, or environment-specific values.
- Do not turn small docs updates into broad rewrites.
- Do not copy large external examples into repo guidance; summarize the operational rule and link to source docs when useful.
