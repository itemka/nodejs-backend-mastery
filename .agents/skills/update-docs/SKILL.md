---
name: update-docs
description: Use when updating README files, API examples, changelogs, migration notes, setup docs, developer workflows, or AI-agent guidance for Codex, Claude Code, Cursor, MCP, skills, agents, commands, hooks, prompts, or checklists.
metadata:
  created: '2026-04-25'
  status: 'baseline'
  portability: 'cross-tool'
  last-reviewed: '2026-04-25'
---

# Update Docs

## Purpose

Keep documentation accurate, concise, and tied to real code behavior.

## When To Use

- A change affects user-facing behavior, API contracts, setup, config, migrations, or developer workflow.
- The user asks to document a feature, bug fix, architecture decision, or operational note.
- Existing docs are stale or incomplete for the task being finished.
- AI-agent docs, skills, agents, commands, prompts, hooks, checklists, MCP notes, or tool adapters may need a current and recent best-practices refresh.

## Inputs

- Current diff or implemented change.
- Existing README, docs, examples, API notes, or templates.
- Validation commands, migration notes, screenshots, or examples when relevant.
- Current official docs when documenting AI tools, CLIs, cloud services, libraries, or other drift-prone behavior.
- Recent official changelogs, release notes, and dated best-practice pages when AI-agent guidance or fast-moving tooling is in scope.
- For AI-agent docs: relevant `.agents/`, `AGENTS.md`, `CLAUDE.md`, `.claude/`, `.cursor/`, `.codex/`, or `.github/` files.

## Related Role Specs

- [update-docs](../../agents/update-docs.md): load for role-shaped documentation review or tool-native docs adapter behavior.
- [task-analyst](../../agents/task-analyst.md): load when the documentation request is broad or missing audience, scope, or acceptance criteria.
- [code-review](../../agents/code-review.md): load when docs are part of a broader diff review.

## Surface Routing

- Portable AI-agent guidance belongs in `.agents/`.
- Tool-specific adapters belong in `AGENTS.md`, `CLAUDE.md`, `.claude/`, `.cursor/`, `.codex/`, or `.github/` and should point back to `.agents/` instead of duplicating it.
- Product, setup, API, and learning docs belong under `docs/` or the nearest package/app README.
- Use commands as short invocable prompts that route to skills; keep procedural source of truth in skills.

## Workflow

1. Inspect the changed code and nearby docs before editing.
2. Identify the audience: user, contributor, operator, reviewer, or future maintainer.
3. Identify the documentation surface and read the index that lists it, such as `.agents/README.md` or a docs index.
4. Check whether the file or subject is stale. If the file is old for its topic, the user flags it as stale, or the topic changes frequently, run a freshness pass before editing.
5. If the surface is AI-agent guidance, run an AI-agent docs refresh before editing:
   - Fetch current official docs at execution time for the referenced tools. Prefer OpenAI Codex docs, Claude Code docs, Cursor docs, and the Agent Skills specification over blog posts or templates.
   - Scan recent official changelogs, release notes, and dated best-practice pages for the referenced tools. Search the last 30 days first; if that finds no useful dated updates, broaden to the last 90 days and say that the window was expanded.
   - Use vendor docs and official changelogs as primary sources. Use community posts or catalogs only when official sources are silent and the user asked for a broader scan; mark them as secondary and do not treat them as authoritative.
   - Compare current guidance against repo files for AGENTS.md, skills, subagents, commands, prompts, hooks, MCP, memory/rules, and tool adapters.
   - Look for naming drift, frontmatter changes, obsolete locations, duplicated instructions, bloated always-loaded context, and unsafe hook or MCP examples.
   - Look for recent behavior changes that should update repo guidance, such as new config locations, deprecations, permission changes, lifecycle hooks, MCP capabilities, subagent behavior, or skill-loading behavior.
   - Apply useful cross-tool updates to `.agents/` first; keep root files and tool adapters thin.
   - If web access or docs lookup is unavailable, say so and do not claim the update is freshness-verified or recent-practice verified.
6. For other drift-prone tooling or APIs, verify current official docs before changing guidance.
7. Prefer editing an existing file. Create a new file only when no existing file fits.
8. Update the smallest relevant doc surface and keep headings, tone, and length consistent.
9. Keep indexes and relative links in sync.
10. Prefer concrete examples over generic explanation.
11. Include setup, validation, migration, rollback, or API examples when they are part of the change.
12. Preserve existing docs shapes, such as the `docs/_todo/` topic README structure, unless the user asked to restructure them.
13. Remove or correct stale statements that conflict with the new behavior.
14. Report changed docs, sources checked, and any docs intentionally left untouched.

## Freshness And Recent-Practices Pass

Use this for AI tools, libraries, framework versions, CLIs, cloud APIs, security-sensitive guidance, or user-flagged stale docs:

1. Note the file or subject being refreshed and the tools or APIs it references.
2. Fetch current official docs for those tools.
3. Fetch recent official changelogs, release notes, or dated best-practice pages:
   - First window: last 30 days.
   - Fallback window: last 90 days, only when the 30-day scan finds no useful dated updates.
   - Say whether the 30-day window was enough or whether the search broadened to 90 days.
4. Compare current guidance and recent changes with the repo file.
5. Update only what is useful for this repo.
6. In the final response, list sources checked, the recency window used, and any meaningful old-to-new guidance changes.

## Output Format

- Docs updated.
- Behavior or workflow documented.
- Examples or migration notes added.
- Validation or source checked.
- AI-agent best-practice and recent-change sources checked, when applicable.
- Remaining documentation gaps.

## Safety Rules

- Do not document behavior that was not implemented or verified.
- Do not include secrets, private URLs, personal paths, or environment-specific values.
- Do not turn small docs updates into broad rewrites.
- Do not copy large official-doc examples into repo guidance; summarize the operational rule and link to source docs when useful.
- Do not present old community examples, marketplace listings, or blog posts as current best practice unless they are clearly secondary and still match official docs.
- Do not duplicate shared `.agents/` guidance in tool-specific adapters.
- Do not keep README-only folders when their useful content belongs in a skill.

## When Not To Use

- The task has no user-facing, operational, setup, API, or contributor-facing documentation impact.
- The user asked for code-only work and docs would be speculative.
