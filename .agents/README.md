# AI Agents

This folder is the shared AI-agent toolkit for the repo. Keep reusable material here first, then add tool-specific adapters only when a tool needs its own format.

Root files stay thin:

- [../AGENTS.md](../AGENTS.md) points agents here.
- [../CLAUDE.md](../CLAUDE.md) imports `AGENTS.md` for Claude Code.
- Tool-specific config belongs in `.codex/`, `.claude/`, `.cursor/`, `.github/`, user-level config, or ignored local files.

## What Belongs Here

- Cross-tool rules for safe software work.
- Reusable workflows for planning, coding, testing, review, documenting, debugging, refactoring, commits, and PRs.
- Portable role specs for specialist review or worker agents.
- Prompt bodies and templates that can be copied into Codex, Claude Code, Cursor, or another agent.
- Review checklists, hook policy, commit guidance, and MCP setup notes.

## What Does Not Belong Here

- Secrets, tokens, API keys, credentials, private URLs, or machine-specific absolute paths.
- Normal product docs or learning-roadmap notes. Use [../docs/](../docs/) for docs.
- Large duplicated tool configs. Keep adapters short and link back here.
- Temporary scratch plans that should live in an issue, PR, or local note.

## Folder Roles

- [rules/project.md](./rules/project.md): small always-on rules every agent should follow.
- [rules/change-discipline.md](./rules/change-discipline.md): rules for keeping diffs safe and focused.
- [rules/repo-map.md](./rules/repo-map.md): project-specific orientation; edit this first when reusing the folder.
- [skills/](./skills/): reusable workflows with clear triggers and output formats.
- [agents/](./agents/): portable role definitions for focused review or implementation support.
- [commands/](./commands/): copy-paste prompt bodies for repeated user-facing workflows.
- [prompts/](./prompts/): fillable prompt templates for tasks, debugging, code review, refactors, and architecture decisions.
- [checklists/](./checklists/): concise review and readiness criteria.
- [hooks/](./hooks/): deterministic automation policy and hook candidates.
- [commits/](./commits/): commit and PR helper templates.
- [mcp/](./mcp/): MCP guidance, safe candidates, and config boundaries.

## Tool Adapter Map

- Codex: `AGENTS.md`, Codex config, Codex skills, hooks, plugins, MCP, and custom agent wiring.
- Claude Code: `CLAUDE.md`, `.claude/skills/*`, `.claude/agents/*`, settings, hooks, and MCP approval.
- GitHub Copilot: `.agents/skills/*` works for project skills; Copilot-specific prompts, custom agents, hooks, and instructions belong under `.github/` when needed.
- Cursor: `AGENTS.md` works as simple instructions; Cursor-specific rules, commands, and MCP config belong under `.cursor/` when needed.

Treat [skills/](./skills/) as the portable source for reusable workflows. Treat [agents/](./agents/), [commands/](./commands/), and [prompts/](./prompts/) as portable source material that can be adapted into tool-native files later.

## Lifecycle Coverage

- Understand a task: [agents/task-analyst.md](./agents/task-analyst.md), [skills/plan/](./skills/plan/), [prompts/task-template.md](./prompts/task-template.md).
- Plan implementation: [agents/plan.md](./agents/plan.md), [commands/plan.md](./commands/plan.md).
- Code: [agents/implement.md](./agents/implement.md), [commands/implement.md](./commands/implement.md), backend/data/refactor skills.
- Test: [agents/tests.md](./agents/tests.md), [skills/validate/](./skills/validate/), [checklists/tests.md](./checklists/tests.md).
- Review: [agents/code-review.md](./agents/code-review.md), [agents/security-reviewer.md](./agents/security-reviewer.md), [skills/code-review/](./skills/code-review/), review checklists.
- Document: [agents/update-docs.md](./agents/update-docs.md), [skills/update-docs/](./skills/update-docs/), [commands/update-docs.md](./commands/update-docs.md), [checklists/documentation.md](./checklists/documentation.md).
- Prepare commits and PRs: [agents/delivery.md](./agents/delivery.md), [skills/commit-preparation/](./skills/commit-preparation/), [commits/](./commits/).
- Debug: [agents/debug.md](./agents/debug.md), [skills/debug/](./skills/debug/), [commands/debug.md](./commands/debug.md).
- Current task context: [skills/current-task-context/](./skills/current-task-context/).
- Improve backend/frontend quality: [agents/code-review.md](./agents/code-review.md), [agents/backend-architect.md](./agents/backend-architect.md), backend/API/security/review checklists.

## Source Priority

Use official product docs as the source of truth for tool-specific file locations and behavior. Use the Agent Skills standard for portable skill shape. Use curated or community catalogs, including Awesome Copilot and public skill repositories, only as inspiration after checking scope, quality, and license.

## Reuse In Another Project

1. Copy `.agents/` into the target repo.
2. Rewrite [rules/repo-map.md](./rules/repo-map.md) for that repo's layout, commands, and production boundaries.
3. Keep [rules/project.md](./rules/project.md), skills, agents, commands, prompts, checklists, hooks, commits, and MCP guidance mostly generic.
4. Add a thin root `AGENTS.md` that links to this folder and the three rule files.
5. Add tool-specific adapters only when needed, for example `.cursor/rules/*.mdc`, `.claude/skills/*`, `.github/prompts/*.prompt.md`, `.github/agents/*.md`, `.github/hooks/*.json`, or Codex config.

Keep project-specific details in `rules/repo-map.md`. Keep reusable workflows generic.
