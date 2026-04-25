# Docs Update Prompt

You are updating AI-agent guidance and/or product documentation in this repo. Treat this prompt as the full task - do not ask for clarification unless a constraint below is impossible to satisfy.

## What To Update

Pick the surface that matches the user's request:

- `.agents/` - portable, cross-tool material (rules, skills, agents, commands, prompts, checklists, hooks, commits, MCP notes).
- Tool adapters - `AGENTS.md`, `CLAUDE.md`, `.cursor/`, `.claude/`, `.codex/`, `.github/`. These are thin and link back to `.agents/`.
- Product/learning docs - `docs/` and the topic tree under `docs/_todo/<category>/<topic>/README.md`.

If the change is portable, edit `.agents/`. If it is tool-specific, edit the adapter and keep `.agents/` as the source of truth.

## How To Work

1. Read the relevant existing file before editing. Match its tone, heading depth, and length.
2. Check the file's last modified date with `git log -1 --format=%cI -- <path>`. If it is older than ~3 months, or the user flags it as stale, run a freshness pass (see next section) before applying the requested edits.
3. Read the index that lists the file (`.agents/README.md`, `docs/_todo/README.md`, or `docs/_todo/guides/README.md`) and keep it in sync.
4. Resolve every relative link and anchor you add or move.
5. Prefer editing in place. Create a new file only when no existing file fits.
6. When adding a new file under `.agents/`, add one bullet for it in `.agents/README.md`. When adding a new topic under `docs/_todo/`, add one row for it in `docs/_todo/README.md`.
7. When the change touches both a portable file and a tool adapter, edit the portable file first and make the adapter point at it instead of duplicating content.

## Freshness Pass

Trigger this when the file is older than its subject's typical churn window (libraries, framework versions, cloud-service APIs, or AI-tool features change on the order of months) or when the user asks for an update of stale content.

1. Note the file's last modified date and list the libraries, framework versions, cloud APIs, or tool features it references.
2. For each one, fetch current docs via `context7` (preferred for libraries, frameworks, SDKs, CLIs, and cloud services) or web search for general best practices.
3. Diff what the file says against current guidance. Flag: deprecated APIs, renamed config, version bumps, new recommended defaults, security advisories, removed features.
4. Update the file with the current guidance. Keep the original structure and length budget; do not balloon the file just because more material exists.
5. In your final summary, list each item you refreshed with a one-line "was -> now" note so the user can audit the change.
6. If a referenced tool, library, or pattern has been deprecated with no clear successor, flag it for the user instead of silently removing it.

## AI-Agent Docs Refresh

Always run this when the requested surface includes `.agents/`, `AGENTS.md`, `CLAUDE.md`, `.claude/`, `.cursor/`, `.codex/`, `.github/`, MCP setup, skills, agents, subagents, commands, prompts, hooks, rules, memories, or checklists.

1. Fetch current official docs at execution time for every referenced AI tool. Prefer:
   - OpenAI Codex docs for AGENTS.md, skills, subagents, hooks, MCP, plugins, and project config.
   - Claude Code docs for memory, skills, subagents, hooks, permissions, settings, and MCP.
   - Cursor docs for rules, commands, AGENTS.md support, and MCP.
   - Agent Skills specification and best-practice docs for portable skill structure.
2. Prefer official documentation over blog posts, community templates, or prior memory.
3. Compare current docs against the repo's AI-agent files. Look for naming drift, frontmatter changes, obsolete tool locations, duplicated instructions, bloated always-loaded context, stale MCP guidance, and unsafe hook examples.
4. Apply useful changes for this repo and keep them cross-tool when possible:
   - Shared guidance goes in `.agents/`.
   - Tool-specific adapters stay thin and point back to `.agents/`.
   - Root `AGENTS.md` and `CLAUDE.md` stay small.
5. If web access or docs lookup is unavailable, state that clearly and do not present the result as current-best-practice verified.
6. In the final summary, list the official sources checked and what changed.

## Hard Rules

- No secrets, tokens, credentials, machine-specific paths, or private URLs.
- Root `AGENTS.md` and `CLAUDE.md` stay thin - they link, they do not duplicate `.agents/` content.
- For AI-agent docs, do not rely only on prior memory or local assumptions when current official docs can be checked.
- The roadmap under `docs/_todo/` is topic-sequenced. Do not add weeks, days, or time-boxes.
- English only. No emoji unless the file already uses them.
- Per-topic READMEs under `docs/_todo/` keep the four-section shape: Metadata, Scope, Sub-tasks, Concepts + Interview questions. Stay under ~80 lines per file.
- Do not restructure folders, rename files, or move sections across files unless the user asked for that.
- Do not introduce new abstractions, frameworks, or tools just to make the docs look richer.

## Output

- Apply the edits directly with the file-editing tools available. Do not paste the full new file into chat unless asked.
- After edits, list each file you changed in a one-line bullet with a short reason.
- If you skipped something the user implied, say so explicitly with the reason.

## Validation Before You Finish

- Every relative link you added or moved resolves.
- Every index that should mention the file does mention it.
- No duplicate guidance between `.agents/` and a tool adapter - the adapter links instead.
- For AI-agent docs, official sources checked during this run are listed in the final response, or the lack of access is explicit.
- Run `git status` and `git diff` mentally: the diff is scoped to the requested surface and contains no incidental rewrites.
- Spot-read each new or heavily edited file cold and confirm it makes sense without the surrounding conversation.

## Risks To Watch

- Drift between portable `.agents/` content and tool adapters.
- Stale links after a rename or move.
- Index files (`.agents/README.md`, `docs/_todo/README.md`) silently going out of sync.
- Leaking session-specific or machine-specific details into committed files.
- Breaking the entry-point chain `AGENTS.md` -> `.agents/README.md` -> `.agents/rules/*`.

## Now Do This

Replace the line below with the actual change request, then execute it under the rules above.

> _Describe the update: what file or surface, what should change, and why. Paste error output, source links, or before/after expectations if relevant._
