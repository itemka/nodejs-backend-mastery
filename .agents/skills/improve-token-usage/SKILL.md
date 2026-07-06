---
name: improve-token-usage
description: Investigate AI-session context cost and produce a prioritized token-usage improvement plan without lowering answer quality. Use when asked to reduce token usage, shrink always-loaded context, improve context loading, or run improve-token-usage.
metadata:
  created: '2026-07-03'
  status: 'baseline'
  portability: 'cross-tool'
  last-reviewed: '2026-07-03'
---

# Improve Token Usage

## Purpose

Investigate where AI coding sessions spend context in this repo and produce an
execution-ready, prioritized plan that reduces token usage while preserving
answer quality and safe code changes.

## When To Use

- Sessions hit token or context limits, or context cost needs review.
- The user asks to reduce token usage, shrink always-loaded context, or improve
  how context is loaded.
- The improve-token-usage command routes here.

## When Not To Use

- Implementing a previously produced token-usage plan; use
  [implement](../implement/SKILL.md) with that plan instead.
- General docs or agent-docs maintenance without a context-cost goal; use
  [update-docs](../update-docs/SKILL.md) or
  [maintain-agent-docs](../maintain-agent-docs/SKILL.md).

## Inputs

- Always-loaded context: entry files, rules, and tool configs.
- The context-loading policy and repo layout in `.agents/rules/repo-map.md`.
- Any previous token-usage plans or audit artifacts under `docs/`.

## Related Skills

- [plan](../plan/SKILL.md): owns the plan artifact policy, file template, and
  naming rules.
- [maintain-agent-docs](../maintain-agent-docs/SKILL.md): owns the freshness
  window for AI-agent guidance claims.

## Workflow

1. Treat the task as investigation and planning only. Do not edit source,
   tests, hooks, config, or instruction files while producing the plan.
2. Follow the plan skill's artifact policy and file template. Prefer
   `docs/plan-improve-token-usage.md` unless the user provides another path.
3. If previous investigation artifacts exist, verify stale claims before
   reusing them, and produce a compact actionable plan instead of appending
   another long audit narrative.
4. Investigate:
   - Which files, folders, docs, rules, prompts, generated files, reports, or
     sample assets may consume too many tokens.
   - Which context is essential, and which can be shortened, moved, ignored,
     summarized, or loaded only on demand.
   - Whether AI instruction files are too verbose, duplicated, or loaded too
     often.
   - How to restructure agent instructions, rules, skills, commands, hooks,
     prompts, and docs so AI tools use less context.
   - What to add to ignore files, permission denies, tool config, hooks, or
     tool-specific guidance to avoid unnecessary context loading.
5. For AI-agent guidance claims, follow the freshness window in
   [maintain-agent-docs](../maintain-agent-docs/SKILL.md).

## Evidence Rules

- Prefer cheap repo evidence before opening large files: `git status --short`,
  `git ls-files <path>`, `git check-ignore -v <path>`, `wc -l` / `wc -c`, and
  `rg --files <focused-paths>`.
- Every finding needs concrete file or folder references, with line numbers
  when useful.
- Respect the avoid-tier sources in the repo map's context-loading policy; do
  not bulk-read dependency folders, generated output, or binary assets unless
  the task explicitly requires them.
- Verify drift-prone findings before turning them into priority actions.
- Redact secrets; do not quote tokens, credentials, private URLs, or local
  secret-bearing config values.

## Plan Content Requirements

Use the plan skill's file template, and make sure the plan includes:

- a short summary of the current token-usage problems
- concrete findings with file or folder references
- recommended actions ordered by priority
- suggested improved structure for AI instruction and context files, if needed
- things that should not change because they preserve quality
- tool-specific notes for Codex and Claude where relevant
- validation commands or evidence checks for each meaningful action
- a small checklist for starting a new session

Keep recommendations practical, low risk, and tool-agnostic where possible;
add Codex- or Claude-specific advice only when tool behavior differs. Order
actions so a future session can apply one focused change at a time.

## Output Format

- Plan file path.
- Highest-priority actions.
- Validation or evidence commands used.
- Official sources checked and whether the 30-day window was enough.
- Anything intentionally left unmodified.

## Safety Rules

- Do not edit source, tests, hooks, config, or instruction files during
  investigation.
- Do not remove important project-specific knowledge to save tokens; preserve
  repo orientation, safety rules, and validation discipline.
- Do not present unverified claims from earlier audits as current findings.
