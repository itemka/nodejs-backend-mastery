# Deno / Fresh (comparison only)

**Category:** frameworks · **Primary app:** — · **Prereqs:** — · **Status:** todo

## Scope
- Deno runtime model vs Node: permissions, web-first APIs, built-in TS.
- Fresh / Hono / Oak — what server-side Deno looks like.
- When to consider Deno for new services (edge-first, isolates, KV).

## Sub-tasks
- [ ] Read the current Deno permissions model; note implications for servers.
- [ ] Write a 1-page Node-vs-Deno comparison focused on backend concerns.

## Concepts to know
- Deno's permissions are opt-in at process level (`--allow-net`, etc.).
- ESM-only, no `node_modules`; URL or JSR imports.
- Runs on isolate-based platforms (Deno Deploy, Cloudflare) with different cold-start profile.

## Interview questions
- Where does Deno meaningfully differ from Node?
- Would you pick Deno for a new service today? Under what conditions?
