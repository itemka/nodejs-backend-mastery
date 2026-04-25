# MCP

Model Context Protocol (MCP) lets AI tools connect to external tools and data sources through a shared protocol.

## Policy

- Do not commit secrets, tokens, API keys, credentials, private URLs, or personal database strings.
- Prefer environment variables over inline secrets.
- Keep machine-specific MCP config out of reusable `.agents/` content.
- Treat project-level MCP config as reviewable infrastructure because it can grant tool access.
- Treat user-level MCP config as private local setup.

## Config Scope

- User-level config is best for personal tools, credentials, and local services.
- Project-level config is best for shared, low-risk tooling that every contributor can safely approve.
- Actual MCP config is tool-specific and usually stays gitignored.
- Each tool has its own MCP config location and approval behavior:
  - Claude Code: project-level `.mcp.json` (often gitignored), per-server approval, and an `enabledMcpjsonServers` list in `.claude/settings*.json`. Subagents can scope MCP via the `mcpServers:` frontmatter field.
  - Codex: Codex config (often `.codex/config.toml`, gitignored).
  - Cursor and GitHub Copilot: see their own docs for current locations.
- Restart or relaunch the client when it only reads MCP config at startup.

## Good Candidates

- GitHub for issues, PRs, and code review context.
- Browser or devtools for local frontend inspection.
- Filesystem or repo tools with safe repository boundaries.
- Official docs or search tools for current documentation.
- Local PostgreSQL or Redis only with read-only or clearly bounded access.

## Avoid

- Broad filesystem access outside the repo.
- Production databases without explicit read/write boundaries.
- Inline bearer tokens or API keys.
- Auto-running tools that can mutate external systems.
