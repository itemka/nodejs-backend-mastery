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
- Commit only shared MCP config that is credential-free or uses environment references. Keep credential-bearing or machine-specific MCP config gitignored.
- Each tool has its own MCP config location and approval behavior:
  - Claude Code: `claude mcp add --scope local|project|user`; project scope writes `.mcp.json` in the project root and prompts for approval before use. `.mcp.json` supports environment expansion such as `${VAR}` and `${VAR:-default}`. Subagents can scope MCP with `mcpServers:` frontmatter.
  - Codex: MCP servers live in Codex `config.toml`; use `codex mcp` or `[mcp_servers.<name>]` tables in user config or trusted project `.codex/config.toml`.
  - Cursor: project MCP config lives in `.cursor/mcp.json`; global config lives in `~/.cursor/mcp.json`; the editor and CLI share configured servers.
  - GitHub Copilot: see its own docs for current MCP support and config locations.
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
