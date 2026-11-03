# ADR-0006: Notion Backup Phone Access

- **Status:** Proposed
- **Decision date:** 2026-11-03 (revises the choice of 2026-10-23)
- **Recorded:** 2026-11-02, revised 2026-11-03

## Context

[notion-backup-automation](../../workspaces/apps/notion-backup-automation/README.md) runs on
Vercel ([ADR 0005](./0005-notion-backup-serverless-runtime.md)). Two things needed the owner's
Mac:

- **Control:** `/mcp` accepts only `Authorization: Bearer $MCP_AUTH_TOKEN`. Connectors added on
  claude.ai also work in the Claude phone apps, since Claude calls the server from Anthropic's
  cloud.
- **Google re-login:** the refresh token lived in the `GOOGLE_REFRESH_TOKEN` Vercel variable, so
  replacing it meant `auth:google` on the Mac (a loopback redirect) plus a redeploy.

On 2026-10-23 (a grill-me session, plan revision 4) Claude's custom connectors offered OAuth or no
auth, not a fixed header. The app therefore got its own OAuth 2.1 authorization server, which was
built and reviewed on 2026-11-02 but never merged.

On 2026-11-03 the owner found that Claude's connectors now send fixed request headers, a beta for
a limited set of accounts, and checked it on production: a connector with Authentication set to
"No sign-in" and the header `authorization: Bearer <MCP_AUTH_TOKEN>` connected, listed the seven
tools, and answered `backup_status` on the web and in the Claude phone app, with no new code
([Claude's connector docs](https://claude.com/docs/connectors/custom/remote-mcp)). Re-logins stay
rare: the production Google token lasts until it is revoked, the password changes, or it goes six
months unused.

## Decision

- **`/mcp` keeps its one bearer token, and Claude sends it as a connector header.** The connector
  uses "No sign-in" and a request header `authorization` with `Bearer <MCP_AUTH_TOKEN>`. `/mcp`
  compares the token in constant time and accepts the scheme in any case (RFC 9110). The app
  serves no OAuth authorization server.
- **A second Google OAuth client** ("Notion Backup Agent Web") in the same Cloud project serves
  the phone re-login (`openid email gmail.readonly drive.file`). The Desktop client stays for
  `auth:google`.
- **The Google refresh token moves into Redis,** as the AES-256-GCM `secret:google-refresh-token`
  envelope whose metadata names its client. The token provider (worker, cron, `/oauth`, and the
  CLI once Redis is configured) reads it first and keeps `GOOGLE_REFRESH_TOKEN` only as a
  fallback. Both the phone re-login (`/oauth/google/reauth`, a fixed, non-secret link) and
  `auth:google` write it, so neither needs a redeploy.
- **Telegram carries the owner's fix:** Fix login for Google opens the re-login link.

## Consequences

- No public sign-in server: nothing to register with, no consent page, no codes or tokens to
  steal, and no way to trick the owner into approving someone else's connector. The only new
  public endpoints are `/oauth/google/reauth` and its callback, which store nothing unless the
  callback proves `OWNER_GOOGLE_EMAIL` (verified, from an ID token checked for the Web client) and
  both scopes.
- **One long-lived token.** Claude stores it encrypted and never shows it again, but it does not
  expire. If it leaks, a caller can start, cancel and retry backups and read their status; no tool
  returns Notion or Drive content, and `/mcp` allows 60 requests an hour. Removing the connector
  only stops Claude from sending it; a leaked copy works until the token changes. The only revoke
  is rotation: a new `MCP_AUTH_TOKEN` in 1Password and Vercel, a Redeploy, then the connector added
  again and every other client (Claude Code, Cursor, Codex) updated. There is no per-client
  revoke.
- **It rests on a Claude beta.** If request headers go away, Claude on the phone loses `/mcp`
  until one of the alternatives below is built; Telegram's buttons keep status, Retry, Cancel and
  Fix login.
- ChatGPT's connectors, which need OAuth, cannot reach `/mcp`.
- The re-login's start link counts per caller IP, 10 an hour, with a shared ceiling of 100, so an
  anonymous caller cannot use up the owner's budget (security review, 2026-11-02). Each start
  stores a sign-in state for 15 minutes under its SHA-256, taken once with `GETDEL`.
- The re-login link is safe to share in Telegram and `backup_status` (`attention.fixUrl`); it is
  the one URL the MCP views allow.
- A redeploy is no longer the way to change the Google token, so 1Password and Redis can drift:
  `auth:google` and the re-login both write Redis, and the plan keeps 1Password the human record.
- Until the Web client and `OWNER_GOOGLE_EMAIL` exist, `/oauth/google/*` answers 503 and Fix login
  replies with the command, so the code ships before the manual setup.
- The 2026-11-02 security review's four open items (revocation that depended on a delivered
  notice, pinning the owner's Google `sub` for the MCP sign-in, a pairing window for new clients,
  and the minor limits on the OAuth endpoints) were all about the OAuth server, so they no longer
  apply.

Open when revised (2026-11-03), to be resolved before this ADR is accepted:

- **S8:** whether Google accepts the Web client's redirect on `<app>.vercel.app` for the unverified
  In-production app from a phone, and whether the Desktop client's Drive Picker grants cover the
  Web client's token.
- **The fresh-session attack** that the [ADR process](./README.md#writing-an-adr) asks for has not
  been run on the revised decision.

## Alternatives

- **An OAuth 2.1 authorization server in the app** (the 2026-10-23 decision; built on
  2026-11-02, then removed before merge): dynamic registration with a redirect allowlist, owner
  approval on a consent page, Google sign-in, PKCE, single-use codes, one-hour access tokens and
  rotating refresh tokens, with a Telegram notice and Revoke on every Allow. It gave per-client
  revocation, short-lived tokens and ChatGPT support. It cost about 1,700 lines of
  security-sensitive code and as many of tests, public registration and sign-in pages, and a
  phishing risk: Claude's and ChatGPT's callbacks are shared by all their accounts, so the owner
  could approve an attacker's connector. Rejected once Claude's request headers made it
  unnecessary.
- **A pre-registered OAuth client for Claude only** (client ID and secret entered in the
  connector): about half that code, and the secret removes the shared-callback risk, but still a
  sign-in server to own. The fallback if request headers go away.
- **A hosted identity provider (WorkOS AuthKit, Auth0, Clerk) or an OAuth library (Better Auth,
  oidc-provider):** a provider adds an account and an outside dependency to sign-in for one user;
  a library needs a SQL database or a framework and still leaves token storage and the Google
  sign-in to the app.
- **Telegram only:** it already covers status, Retry, Cancel and Fix login, with nothing new to
  secure, but gives no conversation with Claude about the backups.
- **`/mcp` without auth, behind an obscure URL:** rejected; the tools start and cancel backups,
  and Claude's servers are public callers anyway.
- **Keeping the Google token in `GOOGLE_REFRESH_TOKEN`:** rejected; replacing it needs a redeploy,
  which a phone cannot trigger. Vercel's API could, but that would give the app a Vercel token with
  far more power than a refresh token.

## Compliance

- [`src/http/bearer-auth.ts`](../../workspaces/apps/notion-backup-automation/src/http/bearer-auth.ts)
  and [`src/http/cron-auth.ts`](../../workspaces/apps/notion-backup-automation/src/http/cron-auth.ts)
  check `/mcp`'s token; [`tests/http/mcp-handler.test.ts`](../../workspaces/apps/notion-backup-automation/tests/http/mcp-handler.test.ts)
  covers them.
- [`src/oauth/`](../../workspaces/apps/notion-backup-automation/src/oauth/) and
  [`src/http/oauth-handler.ts`](../../workspaces/apps/notion-backup-automation/src/http/oauth-handler.ts)
  hold the re-login; [`tests/oauth/`](../../workspaces/apps/notion-backup-automation/tests/oauth/)
  covers it with no network, and [`tests/api/oauth.test.ts`](../../workspaces/apps/notion-backup-automation/tests/api/oauth.test.ts)
  fails if an OAuth server endpoint or rewrite comes back.
- [`tests/api/browser-imports.test.ts`](../../workspaces/apps/notion-backup-automation/tests/api/browser-imports.test.ts)
  keeps the browser out of the `/oauth` function.
- [`src/config/env.ts`](../../workspaces/apps/notion-backup-automation/src/config/env.ts) fails
  `/oauth` closed without the Web client, the owner address and the encryption key.
- The app README's "Phone Access" section documents the connector and the Web client setup; the
  [C4 model](../architecture/workspace.dsl) shows the callers.
- Revisit if Claude drops request headers or changes how connectors authenticate, if the token
  leaks, if a second user or ChatGPT is needed, or if Google requires verification for the Web
  client.
