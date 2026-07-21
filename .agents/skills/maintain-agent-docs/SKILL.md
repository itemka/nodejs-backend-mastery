---
name: maintain-agent-docs
description: Maintains AI-agent documentation and adapters for .agents/, AGENTS.md, CLAUDE.md, .claude/, .codex/, .cursor/, and .github/. Use when creating, updating, auditing, or freshness-checking skills, commands, agents, rules, hooks, MCP notes, prompts, checklists, or tool adapters.
metadata:
  created: '2026-07-03'
  status: 'baseline'
  portability: 'cross-tool'
  last-reviewed: '2026-07-20'
---

# Maintain Agent Docs

## Purpose

Keep AI-agent guidance accurate, lean, current, and structurally sound across shared `.agents/` sources and tool-specific adapters.

## When To Use

- AI-agent docs, skills, agents, commands, rules, hooks, prompts, checklists, MCP notes, or tool adapters need creating, updating, or auditing.
- The user asks for a best-practices refresh of agent guidance.
- A change to Codex, Claude Code, Cursor, AGENTS.md, Agent Skills, MCP, hooks, plugins, or subagents may have made guidance stale.

## When Not To Use

- General READMEs, API examples, changelogs, migration notes, setup docs, or developer workflows need updating; use [update-docs](../update-docs/SKILL.md) instead.
- The task has no AI-agent documentation impact.

## Inputs

- Current diff or implemented change, if any.
- Relevant `.agents/`, `AGENTS.md`, `CLAUDE.md`, `.claude/`, `.codex/`, `.cursor/`, and `.github/` files.
- Current official docs for AI tools, CLIs, skill specs, subagents, hooks, MCP, or adapters being referenced.
- Recent official changelogs, release notes, and dated best-practice pages when the guidance may be stale.

## Related Role Specs

- [maintain-agent-docs](../../agents/maintain-agent-docs.md): load for role-shaped AI-agent documentation review or tool-native adapter behavior.
- [update-docs](../../agents/update-docs.md): load only when general project docs are also in scope.
- [code-review](../../agents/code-review.md): load when agent docs are part of a broader diff review.

## AI-Agent Docs Layout

Single source of truth for the AI-agent docs structure. Other files should reference this section instead of restating it.

- `.agents/skills/` is the canonical home for reusable workflows. Put durable step-by-step procedures here first.
- `.agents/commands/` are short runnable prompts that route to skills. Commands must not duplicate skill bodies.
- `.agents/agents/` are thin role specs (`Purpose`, `When To Load`, `Pairs With`, `Output Contributions`, `Boundaries`). Roles do not restate skill workflows.
- `.agents/checklists/` are compact, scannable verification criteria. Checklists list checks, not procedures.
- `.agents/rules/` are short because every agent loads them on every session. Keep wording tight.
- `.agents/hooks/` holds concrete reusable hook scripts and hook operational notes. Design guidance lives in skills, not in hooks.
- `.claude/`, `.codex/`, `.cursor/`, and `.github/` adapters are thin pointers into `.agents/`. They never copy skill bodies.
- `AGENTS.md` and `CLAUDE.md` are thin entry points; they import or link `.agents/` and do not contain workflows.

## Freshness Window

Use this rule when the change touches AI tools, CLIs, framework versions, cloud APIs, security-sensitive guidance, or user-flagged stale docs:

1. Note the file or subject being refreshed and the tools, specs, or APIs it references.
2. Fetch current official docs for those tools or specs, such as Codex, Claude Code, Cursor, AGENTS.md, Agent Skills, MCP, hooks, plugins, or subagents.
3. Fetch recent official changelogs, release notes, or dated best-practice pages:
   - First window: last 30 days.
   - Fallback window: last 90 days, only when the 30-day scan finds no useful dated updates.
   - State whether 30 days was enough or the search broadened to 90.
4. Use vendor docs and official changelogs as primary sources. Use community posts only as clearly secondary context when official sources are silent.
5. If web access or docs lookup is unavailable, say so and do not claim the update is freshness-verified.
6. Report sources checked, the recency window used, and any meaningful old-to-new guidance changes.

## Structural Review

Run this when the change touches AI-agent guidance (`.agents/`, `.claude/`, `.codex/`, `.cursor/`, `.github/`, `AGENTS.md`, `CLAUDE.md`, related context files, or any skill/agent/command/checklist/rule/hook).

1. Inspect the in-scope files plus their neighbors.
2. Run the `Freshness Window` above before editing.
3. Compare the current layout against `AI-Agent Docs Layout` and the latest official guidance. If official docs or recent best practices suggest a materially better structure, surface the trade-off and recommend keep-or-change. Do not silently restructure.
4. Look for duplicated guidance across skills, commands, agents, checklists, rules, hooks, and tool adapters. Move durable content into the matching skill; leave other surfaces as thin pointers.
5. Look for stale links, stale references to removed or renamed folders/skills/commands, broken relative paths, and dead anchors.
6. Look for overgrown files: rules longer than they need to be, commands restating workflows, role specs restating procedures, checklists that explain instead of check, or tool adapters copying skill bodies. Trim them.
7. Apply cross-tool updates to `.agents/` first; update tool adapters as thin pointers afterward.
8. Preserve frontmatter contracts:
   - Portable skill `name` matches the folder name.
   - `name` is lowercase, hyphenated, 64 characters or fewer, and contains no XML tags.
   - `description` is non-empty, under 1024 characters, contains no XML tags, and front-loads the key use case and trigger terms.
   - Product-specific fields stay on product-specific surfaces unless deliberately documenting a product-specific skill.
9. Preserve discovery contracts:
   - Codex and Claude both discover skills by directory location; keep `.agents/skills/<name>/` and `.claude/skills/<name>/` aligned when adding or renaming a portable skill.
   - Skill descriptions are loaded before full bodies and may be shortened in large skill sets, so keep the first sentence specific.
   - Claude slash-skill command names come from adapter directories, not from portable frontmatter alone.
10. Keep `SKILL.md` bodies concise. Move large references, examples, or templates into supporting files when a skill grows too large.

## Skill Behavior Validation

Run this for new or materially changed skills, including changes to the description, trigger conditions, or workflow.

1. Write two or three realistic prompts that should trigger the skill and one near-miss prompt that should not.
2. Run each should-trigger prompt in a fresh, isolated session with the skill available and compare its output with another fresh session using the complete previous skill version or no skill. Confirm the skill is selected and visibly improves the output.
3. Run the near-miss prompt in its own fresh, isolated session and confirm the skill is not selected.
4. Record the prompts, selection results, and observed uplift in the change summary.

Skip only for cosmetic edits such as typo or link fixes, and state why validation was skipped.

## Safety Rules

- Do not copy large official-doc examples into repo guidance; summarize and link.
- Do not present old community posts as current best practice unless clearly secondary.
- Do not duplicate shared `.agents/` guidance in tool-specific adapters.
- Do not keep README-only folders when their useful content belongs in a skill.
- Do not silently restructure AI-agent folders. Surface the trade-off first.
- Do not encode time-sensitive vendor claims as permanent repo rules unless the guidance says how to refresh them.

## Output Format

- Files updated.
- Sources checked and recency window used.
- Freshness changes adopted or intentionally skipped.
- Structural review findings: duplicates removed, stale links fixed, overgrown files trimmed.
- Structure recommendation, with trade-off, when official docs suggest a materially better layout.
- Trigger-validation evidence (prompts run, selection result, uplift) for new or materially changed skills, or the stated reason it was skipped.
- Remaining gaps.
