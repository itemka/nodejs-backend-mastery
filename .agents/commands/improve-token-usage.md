# Improve Token Usage Command

Use this as a runnable prompt to investigate AI-session context cost and produce
an execution-ready plan for reducing token usage without lowering answer quality.

## Run

1. Read `AGENTS.md` and the rules under `.agents/rules/`.
2. Read and follow [.agents/skills/plan/SKILL.md](../skills/plan/SKILL.md).
3. Treat this as investigation and planning only. Do not edit source, tests,
   hooks, config, or instruction files while producing the plan.
4. Use the plan skill's artifact policy and file template. Prefer
   `docs/plan-improve-token-usage.md` unless the user provides another output
   path.
5. If previous investigation artifacts exist, verify stale claims before reusing
   them and produce a compact actionable plan instead of appending another long
   audit narrative.
6. For AI-agent guidance, check current official Codex and Claude docs plus
   official changelogs. Use a 30-day recency window first, and broaden to
   90 days only if the 30-day pass has no useful dated updates.

## Investigation Brief

Goal: improve token usage in Codex / Claude sessions without losing output
quality.

Context: this repository often reaches token or context limits during AI coding
sessions. The plan should identify where context can be reduced while keeping
enough repo knowledge for high-quality answers and safe code changes.

Recommendation style:

- Prefer practical, low-risk improvements.
- Keep recommendations tool-agnostic where possible.
- Add Codex- or Claude-specific advice only when the tool behavior differs.
- Avoid removing important project-specific knowledge.
- Preserve enough repo orientation, safety rules, and validation discipline for
  high-quality answers and safe code changes.

Investigate:

1. Which files, folders, docs, rules, prompts, generated files, reports, or
   sample assets may consume too many tokens.
2. Which context is essential, and which context can be shortened, moved,
   ignored, summarized, or loaded only on demand.
3. Whether AI instruction files are too verbose, duplicated, or loaded too
   often.
4. How to improve the structure of agent instructions, rules, skills, commands,
   hooks, prompts, and docs so AI tools use less context.
5. What should be added to `.gitignore`, Claude `permissions.deny`, Codex
   config, hooks, or tool-specific guidance to avoid unnecessary context
   loading.
6. How to keep quality high while reducing context size.

## Evidence Rules

- Prefer cheap repo evidence before opening large files:
  - `git status --short`
  - `git ls-files <path>`
  - `git check-ignore -v <path>`
  - `wc -l <files>`
  - `wc -c <files>`
  - `rg --files <focused-paths>`
- Use `git ls-files` or `rg --files` with focused paths for discovery.
- Every finding should include concrete file or folder references, and line
  numbers when they are useful.
- Do not bulk-read `node_modules`, `.pnpm-store`, `dist`, `build`,
  `.playwright-mcp`, generated reports, generated outputs, binary assets, or
  broad `docs/_todo/**` content unless the task explicitly requires them.
- Verify drift-prone findings before turning them into priority actions.
- Redact secrets and do not quote tokens, credentials, private URLs, or local
  secret-bearing config values.

## Plan Content Requirements

Use the plan skill's plan file template, and make sure the resulting plan
includes:

- a short summary of the current token-usage problems
- concrete findings with file/folder references
- recommended actions ordered by priority
- suggested improved structure for AI instruction/context files, if needed
- things that should not change because they preserve quality
- tool-specific notes for Codex and Claude where relevant
- validation commands or evidence checks for each meaningful action
- a small checklist for starting a new Codex / Claude session

The plan should be execution-ready for another LLM, practical, low risk, and
ordered so a future session can apply one focused change at a time.

## Final Response

Report:

- plan file path
- highest-priority actions
- validation or evidence commands used
- official sources checked and whether the 30-day window was enough
- anything intentionally left unmodified
