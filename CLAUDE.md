# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

@AGENTS.md

## Claude Code Notes

Project rules, repo layout, and change discipline are imported from `AGENTS.md` → `.agents/rules/{project,repo-map,change-discipline}.md`. Read those first — they are the source of truth and apply to every AI agent. Do not duplicate their content here.

### Where to find things

- Commands and checks: [.agents/rules/repo-map.md](.agents/rules/repo-map.md) § _Commands And Checks_.
- Workspace layout (apps, AI engineering examples, shared packages): same file, § _Apps_, _AI Engineering_, _Packages_.
- Context-loading policy (what to load eagerly vs. on demand): same file, § _Context Loading Policy_.
- Session handoff file `docs/CURRENT_TASK_CONTEXT.md` (gitignored, optional): [.agents/rules/project.md](.agents/rules/project.md) § _Current Task Context Rule_.

### Claude-specific adapters (thin pointers into `.agents/`)

- `.claude/skills/<name>/SKILL.md` — Claude-native skill adapters; bodies live in `.agents/skills/<name>/SKILL.md`.
- `.claude/agents/*.md` — project subagents (backend-architect, code-review, debug, delivery, implement, plan, security-reviewer, task-analyst, tests, update-docs).
- `.claude/commands/*.md` — slash commands; new workflows should go in `.claude/skills/` instead.
- `.claude/settings.json` — permissions allowlist and hook wiring.

When editing skills, agents, or commands, follow the design rule in [.agents/README.md](.agents/README.md): keep adapters thin and link back to `.agents/`. Run `pnpm run check:adapters` to verify the link map.

### Lifecycle hooks

`.claude/settings.json` wires Node scripts under [.agents/hooks/](.agents/hooks/) to Claude Code events:

- `PreToolUse` (Bash) → `before-bash.mjs` → denies destructive shell, runs pre-commit guardrails for `git commit`.
- `PostToolUse` (Edit/MultiEdit/Write) → `after-edit.mjs` → Prettier + ESLint fix, then scoped tests when a test/spec file changes.
- `UserPromptSubmit` → `inject-git-context.mjs` → injects a small git-status header.
- `Stop` → `stop-checks.mjs` → scoped typecheck on changed workspaces, then a `docs/CURRENT_TASK_CONTEXT.md` reminder.

Hook map and smoke-test snippets: [.agents/hooks/README.md](.agents/hooks/README.md). Design guidance: [.agents/skills/designing-hooks/](.agents/skills/designing-hooks/).

### MCP

Project MCP config is in `.mcp.json` (gitignored, may contain secrets). `pnpm run sync-mcp` mirrors it to `.codex/config.toml`. Configuration guidance: [.agents/skills/configuring-mcp/](.agents/skills/configuring-mcp/).
