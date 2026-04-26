# Claude Code Adapters

This folder contains thin Claude Code adapters for the shared AI-agent material in
[`../.agents/`](../.agents/).

Keep `.agents/` as the source of truth. Add or edit files here only when Claude
Code needs a tool-native location, such as project subagents, skills, or slash
commands.

Discovery notes:

- `CLAUDE.md` imports the shared root `AGENTS.md`; keep both files small.
- Existing project skills under `.claude/skills/` are watched for changes during a Claude Code session.
- Newly added top-level skill directories, subagents, settings, and MCP changes may require `/agents`, `/mcp`, a UI reload, or a new Claude Code session to be discovered.
- `.claude/commands/` remains for compatibility, but prefer `.claude/skills/` for reusable workflows because skills support supporting files and invocation controls.
