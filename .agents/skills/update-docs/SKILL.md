---
name: update-docs
description: Use when updating README files, API examples, changelogs, migration notes, setup docs, developer workflows, or AI-agent guidance for Codex, Claude Code, Cursor, MCP, skills, agents, commands, hooks, prompts, or checklists.
metadata:
  created: '2026-04-25'
  status: 'baseline'
  portability: 'cross-tool'
  last-reviewed: '2026-04-26'
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

- Portable AI-agent guidance belongs in `.agents/`. See `AI-Agent Docs Layout` below for the canonical surface rules.
- Product, setup, API, and learning docs belong under `docs/` or the nearest package/app README.

## AI-Agent Docs Layout

Single source of truth for the AI-agent docs structure. Other files reference this section instead of restating it.

- `.agents/skills/` is the canonical home for reusable workflows. Put durable step-by-step procedures here first.
- `.agents/commands/` are short runnable prompts that route to skills. Commands must not duplicate skill bodies.
- `.agents/agents/` are thin role specs (`Purpose`, `When To Load`, `Pairs With`, `Output Contributions`, `Boundaries`). Roles do not restate skill workflows.
- `.agents/checklists/` are compact, scannable verification criteria. Checklists list checks, not procedures.
- `.agents/rules/` are short because every agent loads them on every session. Keep wording tight.
- `.claude/`, `.codex/`, `.cursor/`, `.github/` adapters are thin pointers into `.agents/`. They never copy skill bodies.
- `AGENTS.md` and `CLAUDE.md` are thin entry points; they import or link `.agents/` and do not contain workflows.

## Freshness Window

This is the single source for the AI-agent docs recency rule. Other files in this repo reference this section instead of restating it.

Use this rule for AI tools, libraries, framework versions, CLIs, cloud APIs, security-sensitive guidance, or user-flagged stale docs:

1. Note the file or subject being refreshed and the tools or APIs it references.
2. Fetch current official docs for those tools (Codex, Claude Code, Cursor, Agent Skills, MCP, etc.).
3. Fetch recent official changelogs, release notes, or dated best-practice pages:
   - First window: last 30 days.
   - Fallback window: last 90 days, only when the 30-day scan finds no useful dated updates.
   - State whether 30 days was enough or the search broadened to 90.
4. Use vendor docs and official changelogs as primary sources. Use community posts only as clearly secondary context when official sources are silent.
5. If web access or docs lookup is unavailable, say so and do not claim the update is freshness-verified.
6. In the final response, list sources checked, the recency window used, and any meaningful old-to-new guidance changes.

## AI-Agent Docs Review

Run this when the change touches AI-agent guidance (`.agents/`, `.claude/`, `.codex/`, `.cursor/`, `.github/`, `AGENTS.md`, `CLAUDE.md`, related context files, or any skill/agent/command/checklist/rule).

1. Inspect the in-scope files plus their neighbors: `.agents/**`, `.claude/**`, `.codex/**`, `.cursor/**`, `.github/**`, `AGENTS.md`, `CLAUDE.md`.
2. Run the `Freshness Window` above first. Check current official best practices before editing.
3. Compare the current layout against `AI-Agent Docs Layout` and the latest official guidance:
   - If official docs or recent best practices suggest a materially better folder or file structure, point it out explicitly, describe the trade-off, and recommend whether to keep or change the current structure. Do not silently restructure.
4. Look for duplicated guidance across skills, commands, agents, checklists, rules, and tool adapters. Move durable content into the matching skill and leave other surfaces as thin pointers.
5. Look for stale links, stale references to removed or renamed folders/skills/commands, broken relative paths, and dead anchors.
6. Look for overgrown files: rules longer than they need to be (always-loaded cost), commands restating workflows, role specs restating procedures, checklists that explain instead of check, or `.claude/`/other adapters copying skill bodies. Trim them.
7. Apply cross-tool updates to `.agents/` first; update tool adapters as thin pointers afterward.
8. Preserve frontmatter contracts: skill `name` matches its folder name; required adapter fields stay valid.

## Workflow

1. Inspect the changed code and nearby docs before editing.
2. Identify the audience: user, contributor, operator, reviewer, or future maintainer.
3. Identify the documentation surface and read the index that lists it, such as `.agents/README.md` or a docs index.
4. Check whether the file or subject is stale; if it touches drift-prone tools or AI-agent guidance, run the `Freshness Window` above before editing.
5. For AI-agent guidance, also run the `AI-Agent Docs Review` above before editing.
6. Prefer editing an existing file. Create a new file only when no existing file fits.
7. Update the smallest relevant doc surface and keep headings, tone, and length consistent.
8. Keep indexes and relative links in sync.
9. Prefer concrete examples over generic explanation.
10. Include setup, validation, migration, rollback, or API examples when they are part of the change.
11. Preserve existing docs shapes (for example, the `docs/_todo/` topic README structure) unless the user asked to restructure them.
12. Remove or correct stale statements that conflict with the new behavior.
13. Report changed docs, sources checked, recency window used, and any docs intentionally left untouched.

## Output Format

- Docs updated.
- Behavior or workflow documented.
- Examples or migration notes added.
- Validation or source checked.
- AI-agent best-practice and recent-change sources checked, when applicable.
- AI-agent structural review findings: duplicates removed, stale links/references fixed, overgrown files trimmed, when applicable.
- Structure recommendation (keep current vs. change), with trade-off, when official docs suggest a materially better layout.
- Remaining documentation gaps.

## Safety Rules

- Do not document behavior that was not implemented or verified.
- Do not include secrets, private URLs, personal paths, or environment-specific values.
- Do not turn small docs updates into broad rewrites.
- Do not copy large official-doc examples into repo guidance; summarize the operational rule and link to source docs when useful.
- Do not present old community examples, marketplace listings, or blog posts as current best practice unless they are clearly secondary and still match official docs.
- Do not duplicate shared `.agents/` guidance in tool-specific adapters.
- Do not keep README-only folders when their useful content belongs in a skill.
- Do not silently restructure AI-agent folders. Surface the trade-off and recommend keep-or-change first.

## When Not To Use

- The task has no user-facing, operational, setup, API, or contributor-facing documentation impact.
- The user asked for code-only work and docs would be speculative.
