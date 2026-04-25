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
- AI-agent docs, skills, agents, commands, prompts, hooks, checklists, MCP notes, or tool adapters may need a current best-practices refresh.

## Inputs

- Current diff or implemented change.
- Existing README, docs, examples, API notes, or templates.
- Validation commands, migration notes, screenshots, or examples when relevant.
- Current official docs when documenting AI tools, CLIs, cloud services, libraries, or other drift-prone behavior.
- For AI-agent docs: relevant `.agents/`, `AGENTS.md`, `CLAUDE.md`, `.claude/`, `.cursor/`, `.codex/`, or `.github/` files.

## Workflow

1. Inspect the changed code and nearby docs before editing.
2. Identify the audience: user, contributor, operator, reviewer, or future maintainer.
3. If the surface is AI-agent guidance, run an AI-agent docs refresh before editing:
   - Fetch current official docs at execution time for the referenced tools. Prefer OpenAI Codex docs, Claude Code docs, Cursor docs, and the Agent Skills specification over blog posts or templates.
   - Compare current guidance against repo files for AGENTS.md, skills, subagents, commands, prompts, hooks, MCP, memory/rules, and tool adapters.
   - Apply useful cross-tool updates to `.agents/` first; keep root files and tool adapters thin.
   - If web access or docs lookup is unavailable, say so and do not claim the update is freshness-verified.
4. For other drift-prone tooling or APIs, verify current official docs before changing guidance.
5. Update the smallest relevant doc surface.
6. Prefer concrete examples over generic explanation.
7. Keep docs consistent with existing headings, tone, and structure.
8. Include setup, validation, migration, rollback, or API examples when they are part of the change.
9. Remove or correct stale statements that conflict with the new behavior.
10. Report changed docs and any docs intentionally left untouched.

## Output Format

- Docs updated.
- Behavior or workflow documented.
- Examples or migration notes added.
- Validation or source checked.
- AI-agent best-practice sources checked, when applicable.
- Remaining documentation gaps.

## Safety Rules

- Do not document behavior that was not implemented or verified.
- Do not include secrets, private URLs, personal paths, or environment-specific values.
- Do not turn small docs updates into broad rewrites.
- Do not copy large official-doc examples into repo guidance; summarize the operational rule and link to source docs when useful.
- Do not duplicate shared `.agents/` guidance in tool-specific adapters.

## When Not To Use

- The task has no user-facing, operational, setup, API, or contributor-facing documentation impact.
- The user asked for code-only work and docs would be speculative.
