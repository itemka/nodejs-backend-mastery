---
name: configuring-mcp
description: Plan, review, or document safe MCP server usage and configuration boundaries for AI coding tools.
metadata:
  created: '2026-04-25'
  status: 'baseline'
  portability: 'cross-tool'
  last-reviewed: '2026-04-26'
---

# Configuring MCP

## Purpose

Plan, review, or document Model Context Protocol usage so AI tools can access external tools or data sources with clear scope, secrets handling, and approval boundaries.

## When To Use

- The user asks about MCP servers, tool access, external context, or MCP config.
- A repo or tool adapter needs MCP guidance.
- A proposed MCP server may touch files, browsers, issue trackers, docs, databases, cloud services, or production systems.
- Existing MCP guidance needs a safety, portability, or config-scope review.

## Inputs

- External tool or data source needed.
- Target client, if known: Codex, Claude Code, Cursor, GitHub Copilot, or another MCP-capable tool.
- Whether the setup is personal, project-shared, or organization-managed.
- Required permissions, authentication, transport, and read/write behavior.
- Approval, restart, reload, or discovery notes for the target client.

## Related Role Specs

- [security-reviewer](../../agents/security-reviewer.md): load when MCP access could expose secrets, private data, broad filesystem access, production systems, or unsafe write actions.
- [code-review](../../agents/code-review.md): load when reviewing MCP-related repo changes as part of a broader diff.

## Workflow

1. Identify the external tool or data source the agent needs.
2. Decide whether MCP is actually needed; prefer built-in tools, existing repo scripts, docs, or local commands when they are sufficient.
3. Choose user-level config for personal credentials, local services, and machine-specific setup.
4. Choose project-level config only for shared, low-risk tooling that every contributor can safely approve.
5. Check secret handling before any config is proposed; prefer environment variables, secret managers, or client-supported variable expansion over inline credentials.
6. Define read/write boundaries, including which resources the server can access and which actions need human approval.
7. Avoid broad filesystem access and production database access unless the user explicitly approves the scope and risk.
8. Document approval, reload, restart, or reconnect notes for the target client when they affect discovery.
9. Do not create MCP config files unless the user explicitly requests implementation.

## Output Format

- MCP goal.
- Whether MCP is needed.
- Recommended config scope: user, project, or organization-managed.
- Required server capabilities.
- Secret-handling approach.
- Read/write boundaries.
- Approval, reload, or restart notes.
- Risks and validation plan.

## Safety Rules

- Do not commit secrets, tokens, API keys, credentials, private URLs, personal database strings, or machine-specific paths.
- Treat project-level MCP config as reviewable infrastructure because it can grant tool access.
- Keep credential-bearing or personal MCP setup out of reusable `.agents` content.
- Prefer read-only access until a concrete write workflow is approved.
- Make production access exceptional, explicit, bounded, and reversible.

## When Not To Use

- The task is about hook lifecycle automation rather than external tool access.
- The user only needs a normal shell command, documentation lookup, or repo-local script.
- The request asks to implement MCP config but required access boundaries or credentials are not defined.
