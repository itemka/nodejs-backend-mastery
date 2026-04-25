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
- Actual MCP config may be tool-specific and should usually stay gitignored.
- GitHub Copilot, Codex, Claude Code, and Cursor each have their own MCP config locations and approval behavior.
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
