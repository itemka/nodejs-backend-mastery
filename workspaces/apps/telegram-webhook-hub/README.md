# Telegram Webhook Hub

Independent webhook and delivery service for **Artsem Automation Hub**,
`@artsem_automation_bot`. The Vercel project is `telegram-webhook-hub`, with
`workspaces/apps/telegram-webhook-hub` as its Root Directory. The public webhook
is `https://telegram-webhook-hub.vercel.app/api/webhook`.

The hub owns the bot token, owner chat, webhook configuration, update
authentication, routing, duplicate protection and inbound rate limits. Feature
applications own their business rules and data. They communicate with the hub
through authenticated HTTP; there are no imports from another application.

## Endpoints

| Endpoint             | Authentication                    | Purpose                                                              |
| -------------------- | --------------------------------- | -------------------------------------------------------------------- |
| `POST /api/webhook`  | `X-Telegram-Bot-Api-Secret-Token` | Telegram updates from the owner private chat                         |
| `POST /api/messages` | Integration bearer token          | Send a message, answer a callback or remove buttons                  |
| `GET /api/health`    | Public                            | Basic `{ ok: true, service: 'telegram-webhook-hub' }` process health |

`/api/messages` accepts the strict `@workspaces/telegram-contracts` operation
union. It cannot change the bot webhook, choose a chat destination or call an
arbitrary Telegram method:

```json
{ "action": "sendMessage", "message": { "html": "Backup complete" } }
```

The other operations are `{ "action": "removeButtons", "messageId": 42 }` and
`{ "action": "answerCallbackQuery", "callbackId": "...", "text": "Queued" }`.
Send returns `{ "messageId": 42 }`; other successful operations return
`{ "ok": true }`. A Telegram refusal that a resend cannot change (any 4xx but 429, such as bad
markup or a blocked bot) returns `422 TELEGRAM_REJECTED`; other Telegram or network failures
return `503 TELEGRAM_UNAVAILABLE`. An authenticated `GET` answers 405 (a wrong token 401), which
integrations use as a token check that sends nothing. Sender authentication identifies the integration. Callback
buttons sent by an integration must begin with that integration's ID plus `:`.
URL buttons require HTTPS. The owner chat is selected exclusively by hub config.
Feature applications remain responsible for escaping HTML and sanitizing data.

Registry entries are trusted services authorized to send messages, edit buttons
and acknowledge callbacks in the same owner's chat. They are not sandboxed
tenants: message IDs and callback IDs are not scoped by integration. Callback
namespaces prevent accidental routing collisions; they do not establish a
separate per-integration chat permission boundary.

## Configuration and routing

Copy `.env.example` to `.env.local` and fill it using the relevant 1Password
entries. The setup CLI reads `.env.local` in the workspace directory; existing
process environment variables take precedence. Vercel receives the same values
as Production environment variables. Treat `HUB_INTEGRATIONS` as secret because
it contains bearer credentials.

`HUB_INTEGRATIONS` is a JSON array. Each integration has a unique `id`, command
list, HTTPS `url` and unique `token` of at least 32 characters. The first route:

```json
[
  {
    "id": "nb-prod",
    "commands": ["status", "backup_status"],
    "url": "https://notion-backup-automation.vercel.app/api/integrations/telegram",
    "token": "<integration bearer token>"
  }
]
```

Use the same integration credential in the backup application's
`TELEGRAM_HUB_TOKEN`; set its hub URL and route ID as documented in that app's
README. Keep this credential separate from `TELEGRAM_WEBHOOK_SECRET` and MCP
credentials. The bot token and owner chat belong only in this application's
environment.

- `/status` and `/backup_status` route only to the configured owner of those
  commands. `/start`, `/help`, unknown commands and ordinary text show hub help.
- A callback `nb-prod:s:2026-10` routes to `nb-prod`; the integration receives
  the original callback data `s:2026-10`. The forwarded body is
  `{ "updateId": 1, "input": { "kind": "callback", "callbackId": "...", "data": "s:2026-10", "messageId": 42 } }`.
  Message input is `{ "kind": "message", "text": "/status" }`.
- Existing unprefixed `s:`, `r:`, `f:`, `x:`, `l:` and `c:` buttons route to
  `HUB_LEGACY_INTEGRATION_ID=nb-prod`. This includes existing confirmations;
  their state remains in the backup application. New outgoing buttons always
  use namespaces.
- Unknown namespaces, including an unconfigured `nb-dev`, are refused instead
  of falling back to production. Configure a separate route and backend for
  another environment. Never point a development callback namespace at the
  production backup application.
- Future services add an explicit registry entry and implement the shared
  receiver contract. The hub never accepts a destination URL from an update.
  The reserved hub commands `start` and `help` cannot be claimed by an integration.

The hub forwards with `Authorization: Bearer <integration token>`. Receivers
must independently validate that credential and the strict update schema.
The outbound endpoint is authenticated with the same per-integration token.
Messages and credentials are not logged by the hub, and network/Telegram errors
return only fixed public codes.

## Delivery behavior

Redis uses `HUB_KEY_PREFIX` (default `telegram-hub:prod`), independent of backup
job state. Prefer a separate Redis database; a distinct prefix also works.
Each update has a 60-second processing lease and, after successful handling,
a completed receipt for 48 hours. Lease completion/release uses an atomic
owner-token comparison. Completed duplicates return 200 without forwarding.
An update being handled concurrently returns 503 for Telegram to retry.

Temporary backend/Telegram/Redis failures return 503 and release this request's
lease when possible. A 4xx from an integration other than 408 and 429 (an unknown contract,
a token it refuses, an oversized body) is final: the hub completes the receipt, answers a tap
with `<id> could not handle this button` or replies to a command with a short notice, and
returns 200, since a resend would get the same answer. A backend timeout or lost response may cause redelivery;
the receiving application must deduplicate actions by `updateId`. This is
at-least-once HTTP delivery, not an exactly-once transaction across services.
The receiver must not acknowledge an unhandled temporary failure with 200.

The private chat allows 30 incoming updates per fixed UTC hour. A retry of an
already admitted update does not consume another quota unit. Excess updates
are acknowledged; callback taps receive a short rate-limit notice. Malformed
updates and other chats are ignored with 200. Request bodies are bounded at
64 KiB while streaming. All responses disable caching.

## Deployment

Use Node 24 and pnpm workspaces. Deploy this directory as its own Vercel
project with access to workspace packages outside the Root Directory. Configure
the environment variables described above. Only this application registers the
bot's webhook.

The app's `vercel-build` script builds `@workspaces/telegram-contracts` before Vercel
traces its functions. The package exports JavaScript in `dist/`; runtime exports must
not point to TypeScript sources that the Node builder renames during packaging.

## Setup CLI

From the repository root:

```sh
pnpm --filter telegram-webhook-hub cli telegram:setup [option]
```

| Option        | Behavior                                                                                        |
| ------------- | ----------------------------------------------------------------------------------------------- |
| No option     | Register `/api/webhook` under `APP_BASE_URL`, preserving pending updates.                       |
| `--info`      | Show the current webhook origin and delivery status without changing it; paths are hidden.      |
| `--find-chat` | Save the single private chat ID to `.env.local` with mode 0600; requires no registered webhook. |
| `--test`      | Send a delivery test, including a Status button when the legacy integration is configured.      |
| `--replace`   | Allow replacement of a different registered webhook; valid only with registration.              |

## Local checks

`pnpm install` prepares the shared contracts package. After changing its schemas or
installing with `--ignore-scripts`, rebuild it before using the hub:

```sh
pnpm --filter @workspaces/telegram-contracts build
pnpm --filter telegram-webhook-hub typecheck
pnpm --filter telegram-webhook-hub lint
pnpm --filter telegram-webhook-hub test
```

The Vercel entry points are native Web API handlers. Tests use fake Telegram,
state and HTTP dependencies and do not access the live bot or Redis. The hub
has no Google, Notion, QStash, Playwright or Chromium runtime dependencies.

See [the webhook flow](docs/webhook-flow.md).
