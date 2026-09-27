# Claude Code Adapters

This folder contains thin Claude Code adapters for the shared AI-agent material in
[`../.agents/`](../.agents/).

Keep `.agents/` as the source of truth. Add or edit files here only when Claude
Code needs a tool-native location, such as project subagents, skills, or slash
commands.

Discovery notes:

- `CLAUDE.md` imports the shared root `AGENTS.md`; keep both files small.
- Existing project skills under `.claude/skills/` are watched for changes during a Claude Code session.
- `rules/` holds path-scoped rules: each file declares `paths` globs in frontmatter and loads only
  when Claude reads a matching file. A rule without `paths` loads every session, at the same cost
  as `CLAUDE.md`. Scope and review date: [ADR-0004](../docs/adr/0004-path-scoped-claude-rules.md).
- A skill is a directory whose entrypoint is `SKILL.md`, and the directory name becomes the slash-command name; a flat `.md` file placed directly in `.claude/skills/` is not discovered.
- Newly added top-level skill directories, subagents, settings, and MCP changes may require `/mcp`, a UI reload, or a new Claude Code session to be discovered. Create or manage subagents by editing `.claude/agents/` directly (the `/agents` wizard was removed in Claude Code 2.1.198).
