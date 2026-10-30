# ADR-0005: Notion Backup Serverless Runtime

- **Status:** Proposed
- **Decision date:** 2026-10-01
- **Recorded:** 2026-10-30

## Context

[notion-backup-automation](../../workspaces/apps/notion-backup-automation/README.md) must store
Notion's official workspace export in Google Drive every month without a person clicking through
it. An export takes minutes to hours to arrive by email. A period gets one normal job, and each
export attempt clicks Export at most once. Recovery may request another export only within the
job's attempt limit (`MAX_EXPORT_ATTEMPTS`). Unless the job is forced, a backup already stored for
the period is adopted rather than uploaded again.

This is a retrospective record. The hosting decision was made on 2026-10-01, replacing a first
design of a local macOS `launchd` CLI, and the app was built from PR #53 to PR #74. The reasoning
for leaving the local design was not preserved, so this record does not invent it. The spike
branches were never pushed, so their measurements are copied here.

The limits that shaped the design, checked against official documentation on 2026-10-01: a Vercel
Hobby function runs for at most 300 s, with 2 GB of memory, a 250 MB bundle and 500 MB of `/tmp`;
Hobby keeps runtime logs for 1 hour, runs a cron at most once a day, and is for non-commercial
use. QStash's free plan allows 1,000 messages a day. Upstash archives a free database after 14
idle days. Gemini's free tier may use submitted content to improve Google's products.

## Decision

Run the app as plain Vercel Hobby functions in `fra1`, with no framework and no always-on process:

- **Execution:** a job advances in resumable, idempotent ticks, one step per invocation. QStash
  (EU) publishes each wakeup, only while a job is active. One daily Vercel Cron handles the monthly
  start, the watchdog, the health probes and the heartbeat.
- **State:** the Upstash Redis database in `eu-central-1` holds jobs, leases, events and the
  encrypted Notion session. Compare-and-set writes, leases and a per-wakeup schedule token make a
  redelivered wakeup a no-op.
- **Export:** a serverless Chromium (`@sparticuz/chromium`, `playwright-core`) replays a session
  captured by a local, headed `auth:notion` and clicks Export. Everything else uses APIs: Gmail,
  an HTTP download with the session's cookies, and Drive. No Notion API, password or MFA secret is
  used.
- **Transfer:** one invocation downloads, verifies and uploads the ZIP through `/tmp`. The env
  schema accepts only `TRANSFER_MODE=tmp`.
- **Control:** a stateless remote MCP server starts, inspects and retries jobs, and Telegram
  inspects, retries and cancels them; neither runs a step. The independently deployed
  [telegram-webhook-hub](../../workspaces/apps/telegram-webhook-hub/README.md) alone owns the bot
  and calls the Bot API (decided 2026-10-28).
- **Incidents:** deterministic rules handle every known failure. A bounded Gemini supervisor
  triages selected incidents through a replaceable port, using content-free context and a closed
  set of 7 actions, one per wakeup. `AGENT_MODEL_PROVIDER=none` removes the LLM call.

## Consequences

- Nothing runs between jobs: with no active job, QStash carries no messages, and the daily cron is
  the only scheduled invocation.
- Tick boundaries carry real cost: every step needs a saved marker, and crash, duplicate and
  concurrency behavior needs its own tests. The state machine is the largest part of the app.
- The ZIP size is capped. Unpacked Chromium uses 210 MB of `/tmp`, leaving about 290 MB. In the
  spike, a 250 MiB synthetic ZIP fit with a 16 MiB reserve, and everything but the download took
  about 14 s. A larger export ends as `TMP_SPACE_INSUFFICIENT` until a `stream` mode exists.
- One hour of logs is too short to diagnose a monthly job, so job events in Redis are the lasting
  record, and notifications are written there too.
- A daily cron cannot notice a stopped app, so an outside healthchecks.io check alerts when its
  pings stop.
- The app depends on Notion's Settings UI, which can change without notice (`NOTION_UI_CHANGED`),
  and on a browser session that a person must renew. Warnings 30, 7 and 1 days before expiry and an
  automatic resume after `auth:notion` limit that cost, but do not remove it.
- `--single-process` Chromium is required on Vercel, and early spike runs left 265 MB core dumps
  holding browser memory. The launcher therefore disables core dumps and deletes any it finds.
- Hobby's non-commercial term fits this personal use and would have to be revisited for any other.
- A backup needs Vercel, Upstash, Notion and Google, with no fallback for any of them: an outage
  uses its retry budget, then reports. Telegram and Gemini are optional: a failed notification is
  only logged, and without the model an incident goes straight to the owner.

Open when recorded (2026-10-30), to be resolved before this ADR is accepted:

- **No full-size backup has run on this runtime.** The only real export in the transfer spike was
  1 KB, and exports since 2026-10-18 hold 3 files against 198 on 2026-10-01; the cause is still
  being confirmed. Download speed at full size is unmeasured: the 150 s target needs about 2 MB/s
  from Notion's file host.
- **The final Google token is not in place.** Publishing the unverified OAuth app is expected to
  work under personal use; if Google refuses it, Testing tokens expire after 7 days and unattended
  monthly runs are not possible.
- **Auto-start is off** (`AUTO_START_ENABLED=false`), so no month has yet run by itself.
- **The fresh-session attack** that the [ADR process](./README.md#writing-an-adr) asks for has not
  been run.

## Alternatives

- **A local macOS `launchd` CLI:** the first design (2026-09-30), replaced before it was built. Its
  comparison with this runtime was not preserved. The local CLI survives for sign-in and
  diagnostics.
- **Polling from Vercel Cron alone:** not possible on Hobby, where a cron runs at most once a day
  and an export needs a check at +5 and +15 minutes.
- **A Cloud Run worker:** kept as the fallback for a real blocker, for the affected adapter only.
  The spikes found no blocker: Chromium and a restored session (3 days, cold runs of 37–41 s, peak
  RSS at most 1,185 MB), QStash semantics (7 of 7 checks) and the transfer all passed on Vercel.
- **A chunked or streaming transfer:** deferred, because the one-invocation transfer passed its
  spike and is simpler. It is the next step if exports outgrow `/tmp`.
- **The Notion API or a Notion MCP:** rejected, because the requirement is Notion's official export
  ZIP.
- **Storing a password or automating MFA:** rejected. An email-code login, which opens no new way
  into the account, is planned separately behind its own spike.
- **Postgres for state:** deferred until history queries appear. Jobs, leases and events need only
  the Redis database that already exists.

## Compliance

- [`vercel.json`](../../workspaces/apps/notion-backup-automation/vercel.json) pins the region,
  function limits and cron. [`src/config/env.ts`](../../workspaces/apps/notion-backup-automation/src/config/env.ts)
  refuses a missing or malformed variable, and any transfer mode but `tmp`.
- [`tests/api/browser-imports.test.ts`](../../workspaces/apps/notion-backup-automation/tests/api/browser-imports.test.ts)
  keeps the browser out of the MCP and Telegram functions.
- `pnpm --filter notion-backup-automation test` covers transitions, crashes after every saved
  transition, duplicate and concurrent wakeups, and "no active job means no publish", with no
  network or credentials.
- `backup_health` reports the probes, the last cron run and whether auto-start is on. The
  [C4 model](../architecture/workspace.dsl) and the app's
  [lifecycle diagrams](../../workspaces/apps/notion-backup-automation/docs/backup-lifecycle.md)
  must change with this runtime.
- Revisit this decision if an export approaches 250 MiB, a transfer outlasts one invocation, or a
  Vercel, QStash or Upstash free-plan limit changes.
