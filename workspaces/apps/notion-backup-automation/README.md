# notion-backup-automation

A backup agent that will request the official Notion workspace export every month and store
the ZIP in Google Drive. It runs as Vercel Functions.

**Status:** Google OAuth, the Drive access check and the Gmail export-email finder (Phase 2),
the Drive backup storage with its resumable uploader (Phase 3), the ZIP transfer from the
export link to Drive (Phase 4), the Notion session bootstrap and export trigger with
Playwright (Phase 5), the backup job itself, run one idempotent tick at a time, with console
and Telegram notifications (Phase 6), the QStash worker and the daily cron (Phase 7), and the
remote MCP server and the Telegram buttons (Phase 8), with a local CLI. The functions are
`GET /api/health`, `POST /api/jobs/process/[jobId]`, `GET /api/cron/daily`, `POST /mcp` and
`POST /api/integrations/telegram`; the Gemini supervisor comes next.

## Layout

| Path                          | Purpose                                                                                                                               |
| ----------------------------- | ------------------------------------------------------------------------------------------------------------------------------------- |
| `api/`                        | Vercel function entry points (Web `Request` → `Response`). No business logic.                                                         |
| `src/config/env.ts`           | Zod env schemas, one subset per function. Errors name the variables, never their values.                                              |
| `src/domain/`                 | The job schema, statuses, transitions and lifecycle rules, schedule and retry policies, periods, naming, the error catalog. Pure.     |
| `src/application/`            | The ports (`ports.ts`), the tick (`process-job.ts`), the application methods (`backup-service.ts`), and the job notifications.        |
| `src/adapters/persistence/`   | Upstash Redis adapters with Lua scripts (`lua/*.lua`), and the in-memory job repository.                                              |
| `src/adapters/google/`        | OAuth: loopback consent with PKCE, the Picker grant, the token provider, and the REST client shared by Gmail and Drive.               |
| `src/adapters/gmail/`         | The export-email finder and its parser: the trust checks and the download-link extraction.                                            |
| `src/adapters/drive/`         | The backup storage (year folders, verified uploads, the sidecar), the resumable uploader, and the S6 access check (C1–C4).            |
| `src/adapters/transfer/`      | The export transfer: the link hop, the cookie download to `/tmp/nba`, the ZIP verifier, and the upload through the storage.           |
| `src/adapters/notion/`        | Playwright: the browser launcher, the saved session, the session gate, the Settings page object, and the export trigger.              |
| `src/adapters/notifications/` | The console and Telegram notifiers, and `CompositeNotifier`, which fans out and never throws.                                         |
| `src/adapters/telegram/`      | The authenticated hub HTTP client, and the message formats (HTML-escaped, allowlisted fields, inline buttons).                        |
| `src/adapters/qstash/`        | The QStash scheduler (EU, deduplicated, flow-controlled wakeups) and the signature verifier (`Receiver`, `devMode: false`).           |
| `src/adapters/heartbeat/`     | The healthchecks.io ping after each cron run, or a no-op without `HEARTBEAT_PING_URL`.                                                |
| `src/http/`                   | The functions' HTTP layer: QStash, cron, MCP bearer and Telegram authentication, rate limits, the handlers, content-free bodies.      |
| `src/mcp/`                    | The MCP server factory, the 7 tools (Zod schemas, annotations), and the allowlisted views they and Telegram's `/status` return.       |
| `src/telegram/`               | The authenticated integration: normalized update schema, leased receipts, buttons mapped to job methods and second-tap confirmations. |
| `src/config/containers.ts`    | The composition root: the notifiers, the backup services, the control services of `/mcp` and the webhook, and each function.          |
| `src/cli/`                    | The local CLI: `auth:*`, `drive:*`, `doctor`, `smoke:qstash`, `telegram:setup`, and the `dev:*` helpers, `dev:tick` among them.       |
| `src/shared/`                 | The redacting JSON-line logger, envelope crypto (AES-256-GCM), the `.env.local` writer, masking, `SecretValue`, clock, IDs.           |
| `tests/`                      | Vitest. `tests/contract/` holds the repository contract; `tests/live/` and `tests/browser/` the opt-in suites; `tests/fixtures/`.     |
| `vercel.json`                 | Region, per-function limits, the Chromium files the worker and the cron need, the `/mcp` rewrite, and the daily cron.                 |
| `.env.example`                | Template for the untracked `.env.local`.                                                                                              |

## Commands

```sh
pnpm --filter notion-backup-automation typecheck
pnpm --filter notion-backup-automation test
pnpm --filter notion-backup-automation lint
NBA_LIVE_REDIS=1 pnpm --filter notion-backup-automation test:live
pnpm --filter notion-backup-automation test:live:drive
pnpm --filter notion-backup-automation test:browser
```

`test` never touches the network, a browser or real credentials. `test:live` runs the repository
contract, the secret store and the health store against real Redis, using
`UPSTASH_REDIS_REST_URL` and `UPSTASH_REDIS_REST_TOKEN` from `.env.local`. It writes only under
`{nba:test}:live-<run>:` and deletes those keys afterwards. Without `NBA_LIVE_REDIS=1` it skips.
It also runs against a local Redis behind
[serverless-redis-http](https://github.com/hiett/serverless-redis-http), which accepts plain
`http://` URLs.

`test:live:drive` runs the S6 Drive checks against the real backup root (see below). It creates
two empty probe files and deletes them again.

`test:browser` runs the Notion trigger with your installed Chrome, headless, against a local
stand-in for Notion's app (`tests/fixtures/notion/workspace.html`, served on `127.0.0.1`). The
stand-in follows the Settings path, labels and dialog recorded in Phase 0 and S2; its final
Export posts the dialog values to the local server. It never opens Notion. The suite checks the
session gate's verdicts, the values the dialog is set to, the reload retry, and that nothing
throws after the final click.

Local configuration lives in `.env.local`: copy `.env.example`, run `chmod 600 .env.local` and
fill in the values. Git ignores `.env.local` and every other `.env.*` file except the example.

## Local CLI

The CLI reads `.env.local` (shell variables win) and prints masked or content-free output only:
never a token, a download link, an email's subject or body, or the full mailbox address. Its
JSON logs go to stderr at `LOG_LEVEL` (default `warn`).

```sh
pnpm --filter notion-backup-automation auth:google [--print] [--pick-folders]
APP_ENV=dev pnpm --filter notion-backup-automation auth:notion
pnpm --filter notion-backup-automation drive:check [--year YYYY]
pnpm --filter notion-backup-automation cli drive:init
pnpm --filter notion-backup-automation cli doctor [--email-since YYYY-MM-DD]
APP_ENV=dev pnpm --filter notion-backup-automation cli dev:upload <file.zip>
APP_ENV=dev pnpm --filter notion-backup-automation cli dev:trigger [--dry-run] [--headed]
APP_ENV=dev pnpm --filter notion-backup-automation cli dev:download [--email-since YYYY-MM-DD]
APP_ENV=dev pnpm --filter notion-backup-automation cli dev:tick --start [--force]
APP_ENV=dev pnpm --filter notion-backup-automation cli dev:tick <jobId> [--retry | --cancel]
pnpm --filter notion-backup-automation cli telegram:setup --test
pnpm --filter telegram-webhook-hub cli telegram:setup --info
APP_ENV=prod pnpm --filter notion-backup-automation cli smoke:qstash
```

| Command                      | What it does                                                                                                                                                                                                                                                                                                                                                                      |
| ---------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `auth:google`                | Opens Google consent for `gmail.readonly` and `drive.file` (Desktop client, loopback redirect on `127.0.0.1`, PKCE, `state`). Writes `GOOGLE_REFRESH_TOKEN` into `.env.local` (0600) and prints it masked. `--print` also prints the token itself, to paste into 1Password.                                                                                                       |
| `auth:google --pick-folders` | S6 fallback 1: a separate `drive.file`-only consent with the Google Picker. Pick `Full Workspace` and the year folder; the grant belongs to the app, and this consent's token is discarded.                                                                                                                                                                                       |
| `drive:check`                | S6: C1 the root is visible, C2 exactly one year folder is visible in it, C3 a file can be created and deleted in the root, C4 the same in the year folder. Exits 0 when C1 and C3 pass.                                                                                                                                                                                           |
| `drive:init`                 | S6 fallback 2: creates the app-owned `Full Workspace` folder at the top of My Drive (once), and prints its ID and the manual steps.                                                                                                                                                                                                                                               |
| `doctor`                     | Refreshes the Google token and lists its scopes, reads the masked mailbox, finds the newest trusted export email since `--email-since` (a day in `BACKUP_TIME_ZONE`; default: the last 30 days), checks the Drive root (C1), pings Redis, and opens the Notion session secret of `APP_ENV`. Exits 1 if a check fails; an expired Testing token names the fix.                     |
| `dev:upload`                 | Only with `APP_ENV=dev`. Uploads a local file as today's backup into `_dev/<YYYY>/` in the Drive root, through the same storage code the worker uses, and prints the Drive file ID, size, SHA-256 and the sidecar outcome. A second run with the same file uploads nothing. Exits 1 if the sidecar failed.                                                                        |
| `auth:notion`                | Opens Chrome on Notion's login page; you sign in yourself, MFA included. Saves the session, encrypted, to Redis for `APP_ENV` and checks it again in a headless browser (see [Notion Session And Export](#notion-session-and-export)). Exits 1 if no cookie matches `file.notion.com`, since the export download needs one. Then resumes a job that waits for the Notion login.   |
| `dev:trigger`                | Only with `APP_ENV=dev`. Requests one real workspace export in Notion's Settings with the saved session, so Notion sends its export email. `--dry-run` goes up to the dialog's Export button, sets the dialog values, and cancels. `--headed` shows the window. Exits 1 when the click was sent but no confirmation appeared.                                                     |
| `dev:download`               | Only with `APP_ENV=dev`. Finds the newest trusted export email since `--email-since` (default: the last 7 days), downloads its ZIP with the saved session's cookies into a temporary directory, checks the signature and the archive, prints the size, SHA-256 and file count, and deletes the copy. Nothing is uploaded.                                                         |
| `dev:tick`                   | Only with `APP_ENV=dev`. The whole backup, one tick per call, with the worker's code (see [Backup Jobs](#backup-jobs)). `--start` creates this month's job (`--force`: `<period>-r<N>`); `<jobId>` runs its next step and prints the job and when the next step is due; `--retry` and `--cancel` stand in for `backup_retry` and `backup_cancel`. Exits 1 when the job needs you. |
| `telegram:setup --test`      | Sends a test notification through the hub with a Status button. All other modes print the matching `telegram-webhook-hub` CLI command without changing the bot.                                                                                                                                                                                                                   |
| `smoke:qstash`               | Publishes a signed `_ping` through QStash (EU) to the worker at `APP_BASE_URL` and waits up to 2 minutes for the worker to record its nonce in Redis for `APP_ENV`. Only a delivery whose signature the deployed worker verified can write it. Needs `QSTASH_TOKEN` and `APP_BASE_URL`.                                                                                           |

While the Google OAuth app is in **Testing**, refresh tokens expire after 7 days. When `doctor`
reports `GOOGLE_AUTH_REQUIRED`, run `auth:google` again.

The export email is trusted only when Gmail's own, topmost `Authentication-Results` header
reports a DKIM pass for `@mail.notion.com` and a DMARC pass for `mail.notion.com`, the single
`To` address matches the authenticated Gmail profile, the sender, subject and `X-Feedback-Id`
subtype (`export-completed`) match, and the HTML holds
exactly one "here" link to `https://mg.mail.notion.com/c/…`. The link is read again when the
download needs it, and is never stored, logged or returned.

Gmail's selector and signature prefix must identify exactly one Notion DKIM signature covering
`From`, `To`, `Subject` and `X-Feedback-Id`; missing or ambiguous coverage is rejected. The
recipient is checked again before returning a download link. Provider-controlled Drive folder
names are quoted and control characters escaped before terminal output.

The Gmail finder follows result pages past rejected candidates. Its default budget is ten
pages of ten candidates; reaching the budget with more results raises `EMAIL_SEARCH_LIMIT`
instead of reporting that no email arrived. Investigate matching-message floods or review the
scan budget before retrying.

An ambiguous probe creation is reconciled by its generated name, app marker and parent. A
single recovered probe is deleted; ambiguous matches or failed cleanup are reported by ID,
and further write probes stop. If Drive cannot reveal the ID, the command reports the unknown
outcome and directs you to inspect app-marked probes before retrying; it never retries the POST.

## Drive Storage

The app has the `drive.file` scope only: it sees the files it created, and the folders you
granted it through the Picker. Backups go to the existing `Backups/Notion/Full Workspace`
folder, whose ID is `GOOGLE_DRIVE_BACKUP_ROOT_FOLDER_ID`.

**Setup (S6 outcome, mode `existing`).** Run `auth:google --pick-folders` and pick
`Full Workspace` and its `2026` folder; grants add up across runs and belong to the app. Then
`drive:check` must pass C1–C4. Picking a folder does not reveal its existing children, so each
folder the app must see has to be picked. Later years need no grant: the app creates them.

```text
Full Workspace/                       GOOGLE_DRIVE_BACKUP_ROOT_FOLDER_ID (picked)
├── 2026/                             your folder (picked); found by its exact name
│   ├── notion-workspace-2026-10-01.zip
│   └── notion-workspace-2026-10-01.zip.sha256
├── 2027/                             created by the app, appProperties.notionBackupYear
└── _dev/                             created by the app for APP_ENV=dev, appProperties.notionBackupDev
    └── 2026/
```

- **Year folders** are found by exact name under the root, or created. Two folders with the
  same year fail with `DRIVE_ROOT_INACCESSIBLE`. `drive.file` hides a folder whose grant is
  lost, so a hidden folder looks missing. The root must be visible before anything is created.
  In your root, the app creates only years after every year folder it can see. A hidden `2026`
  therefore fails with `DRIVE_ROOT_INACCESSIBLE` instead of getting a second `2026` next to it;
  pick it again with `auth:google --pick-folders`. In the `drive:init` root and in `_dev`, the
  app created every folder, so it creates any missing year.
- **`APP_ENV=dev`** writes everything under `_dev`, so test uploads never reach the real year
  folders.
- **Each ZIP** carries `appProperties` `notionBackupPeriod`, `notionBackupJobId` and
  `notionBackupSha256`. It counts as a backup only while Drive's own `sha256Checksum` matches
  `notionBackupSha256`, so an unfinished or corrupted upload is never adopted. Before uploading,
  the app looks for a verified ZIP with the same SHA-256 and reuses it.
- **Uploads** use Drive's resumable protocol in 16 MiB chunks. A dropped connection, 429 or 5xx
  asks Drive how many bytes it holds and resumes from there; a short `Retry-After` is waited out,
  a longer one ends the attempt with `DRIVE_UNAVAILABLE`. An expired session (404) starts again
  from byte 0. Drive creates the file only after the last chunk, so a failed upload leaves
  nothing behind.
- **Verification:** Drive's size and SHA-256 must match the local ones; this is the same
  SHA-256 check that later finds the backup again. Drive is asked again for up to 7 s while it
  has not computed the SHA-256. On a mismatch, no SHA-256, or a failed read, the new file is
  deleted; a mismatch fails with `DRIVE_CHECKSUM_MISMATCH`.
- **The sidecar** `<name>.zip.sha256` holds `<sha256>  <name>.zip`, so
  `shasum -a 256 -c notion-workspace-YYYY-MM-DD.zip.sha256` checks a downloaded copy. It is
  written once per ZIP name and SHA-256 (`WRITE_SHA256_SIDECAR`, default `true`). If it fails,
  the ZIP stays and the failure is logged.
- **Streams** (`content.kind: 'stream'`; no transfer uses them yet) are hashed while they
  upload. Once Drive's SHA-256 matches, a verified copy with the same SHA-256 wins and the new
  file is deleted; otherwise `notionBackupSha256` is recorded on it. Any failure on the way
  deletes the new file. If Drive refuses to delete a duplicate, the result names it as
  `leftoverFileId`.
- **Aborts:** the upload's `AbortSignal` (the transfer budget) ends requests, waits and stream
  reads at once, from the year-folder lookup to the sidecar. Deleting an unverified new file
  still runs after an abort.

## ZIP Transfer

`TmpExportTransfer` (`TRANSFER_MODE=tmp`, the Phase 0 choice) moves one export from the email's
link to Drive within one invocation. The job saves a progress marker before each step through
`onStep`; the transfer budget is its `AbortSignal`.

1. **Link.** The Mailgun link is read again from Gmail and followed one hop, without cookies and
   with `redirect: 'manual'`. Only a redirect to `https://file.notion.com/f/…` with
   `table=user_export` and a numeric `expirationTimestamp` is accepted; anything else is
   `EMAIL_UNRECOGNIZED`. A link past its expiry ends the run as `link_expired`, with no request
   to `file.notion.com`.
2. **Download** (`DOWNLOADING`). The request carries a `Cookie` header built from the saved
   Notion session: only Notion's unexpired cookies whose domain and path match
   `file.notion.com`. No session, or no matching cookie, is `NOTION_SESSION_EXPIRED` before the
   file host is asked. A 403 before the expiry is `NOTION_SESSION_EXPIRED`; after it, `link_expired`. Any
   redirect from the file host is refused, so the cookies go nowhere else. The ZIP streams to
   `/tmp/nba/<jobId>.zip.part` (0600), hashed on the way, and is renamed only once its length
   matches `Content-Length`. It must fit the free space minus 16 MiB
   (`TMP_SPACE_INSUFFICIENT`). Network errors, 30 s without data, a short body, and 429 or 5xx
   with a `Retry-After` of at most 10 s get 3 attempts within the call, the same rule for the
   link hop; then `DOWNLOAD_FAILED`, with a longer `Retry-After` passed on.
3. **Verify** (`VERIFYING`). yauzl reads the central directory and every entry, rejecting
   absolute or `..` names, encryption, unsupported compression and wrong sizes; the app checks
   each entry's CRC-32 itself. An archive with no files is invalid too. Failures are
   `ZIP_INVALID` with a static reason, never an entry name.
4. **Upload** (`UPLOADING`) through the Drive storage above, from the file, with the SHA-256
   computed during the download.

`/tmp/nba` is emptied before the download and removed after every run, whether it completes,
fails or is aborted. Only `tmp` mode exists: measured on Vercel (S4), a 250 MiB ZIP verifies in
about 1 s and uploads in about 10 s, so `stream` mode is not needed. `TRANSFER_MODE` accepts
only `tmp`; any other value fails the config check (`CONFIG_INCOMPLETE`). The ZIP fixtures and
how each was made are in `tests/fixtures/zips/`.

## Notion Session And Export

No Notion API, integration or password is used: the export is requested in Notion's Settings
with a saved browser session.

**`auth:notion`** launches a headed Chrome (`channel: 'chrome'`) with a fresh, temporary
profile, never your own. If Chrome is missing, it falls back to Playwright's Chromium after
`pnpm --filter notion-backup-automation exec playwright-core install chromium`. You sign in on
`https://app.notion.com/login` yourself; nothing is typed for you. If Google sign-in refuses the
window, use "Continue with email". Then:

1. The session gate opens `NOTION_WORKSPACE_URL` and requires the app shell and a visible
   workspace switcher named exactly `NOTION_WORKSPACE_NAME`, optionally after the workspace
   icon: the name's own initial or an emoji (`'` and `’` count as equal). A workspace whose
   name only contains it, such as "… Archive" or "A …", fails.
2. Of the browser's `storageState()`, only Notion's cookies (`notion.com`, and any left on
   `notion.so`) and the localStorage of Notion's HTTPS origins are kept. An unexpired `token_v2`
   is required, and an unexpired `file_token` for `file.notion.com`, which the export download
   needs: without it, nothing is saved, the session saved before stays, and the command exits 1.
3. The state is saved as `secret:notion-storage-state`: Playwright's `storageState()` JSON as the
   AES-256-GCM-encrypted value, which the transfer reads its cookies from. The envelope's `meta`
   holds the replayed identity (user agent, locale, time zone, viewport), the earliest sign-in
   cookie expiry, and whether `file_token` matches `file.notion.com`. No plaintext file is
   written.
4. A new headless context decrypts it and runs the gate again. The output prints
   `authenticated`, the expiry and the file-host match, never a cookie value.

**The session gate** judges the rendered page, since Notion answers `200` without a session:
its login page is `NOTION_SESSION_EXPIRED`; a CAPTCHA or verification page (Cloudflare,
hCaptcha, reCAPTCHA) is `NOTION_INTERACTIVE_CHALLENGE`; another workspace is
`NOTION_WRONG_WORKSPACE`; a failed load, a 5xx or an app that never renders is
`NOTION_UNAVAILABLE`. Each of the first three needs `auth:notion`, which then resumes the
waiting job; the last is retried.

**The export trigger** (`NotionExportTrigger`) replays the session in a new context with
downloads refused, so the browser never writes the ZIP. It walks Workspace switcher → Settings
(the menu, or else the shortcut) → General → the "Workspace content" row's Export, found by
role and text, never by position. The dialog's values are set where they differ: Export format
**Markdown & CSV**, Database views **Current view**, Page content **Everything**, Create
folders for subpages **on**. A value that cannot be set, or any missing element, is
`NOTION_UI_CHANGED` after one reload. Then `onBeforeFinalClick` runs, so the job can save
`exportClickAt` first, and the dialog's own Export is clicked once:

- `confirmed`: Notion showed "Exporting";
- `already_in_progress`: Notion showed an export already running, so nothing was clicked;
- `in_doubt`: the click was sent but no confirmation appeared. Nothing throws after the click.

Each step waits up to 30 s (S2). An abort closes the browser at once.

**On Vercel** (`VERCEL=1`) the browser is `@sparticuz/chromium`'s headless shell, launched as
S2 proved it: headless, no graphics, `--single-process` kept, and without the three flags that
turn off web security. It starts through a `/bin/sh` wrapper that runs `ulimit -c 0`, and
`core.*` files in `/tmp` are deleted before each launch and when the browser closes: a
single-process Chromium sometimes dumps its memory, session included, on close.

**The rolling refresh:** a call that passed the gate saves the session again when Notion
changed its cookies (a value, an expiry, or the set), with the identity it was saved with. A
capture without `token_v2` or the file host's cookie keeps the saved session. It is best
effort and never throws, since it may follow the final click.

**After `auth:notion`**, a job that waits on `NOTION_SESSION_EXPIRED`,
`NOTION_INTERACTIVE_CHALLENGE` or `NOTION_WRONG_WORKSPACE` is retried as `backup_retry` would.
A dev job publishes nothing (run `dev:tick`); any other is woken through QStash, which needs
`QSTASH_TOKEN` and `APP_BASE_URL` in `.env.local`. Without them, the command names
`backup_retry` instead.

Flow diagrams of the gate, the trigger and `auth:notion`:
[docs/notion-export-flow.md](docs/notion-export-flow.md).

## Backup Jobs

A backup is a job (`job:<period>`, or `<period>-r<N>` when forced) that moves through the state
machine in `src/domain/` one **tick** at a time. Each tick is one QStash delivery to the worker,
or one `dev:tick` locally, and runs exactly one step:

1. Load the job; an unknown job is `not_found`, an ended one `terminal`.
2. A job that waits for you needs no lease. Otherwise take the job's lease: 60 s for a light
   step, 330 s for a heavy one (the trigger, the transfer). A held lease answers `lease_held`
   with the time left.
3. Reload, and check the delivery's **schedule token** against the job's: a superseded wakeup
   is `stale` and does nothing.
4. `nextStep` picks the step: cancel first, then the 168 h lifetime, then rolling back a
   transfer marker a dead worker left, then the status's own step.
5. Run it. Every write is compare-and-set; on a conflict the job is reloaded and the rule
   applied again (3 times at most), or the step stops and the stored state stands. A heavy step
   starts no new work after 270 s, a light one after 45 s.
6. Notify (below), then publish the next wakeup with a **new** token and save that token. A
   failed publish throws before the save, so the delivery's token stays valid for its retry.
   With nothing to wake for (done, or waiting for you), the token is cleared.

The guards, in the order the steps meet them:

- **Drive first.** The trigger and the transfer adopt a verified backup of the period already
  in Drive (the Redis-loss guard) instead of exporting or downloading. A forced job adopts only
  its own backup.
- **Write-ahead click.** `exportClickAt` is saved just before the final Export click. A worker
  that dies after it never clicks again in that attempt: the job waits for the email "in
  doubt", and starts a new attempt after 48 h without one.
- **One email per job.** A found email is claimed (`email:<messageId>`); one another job owns
  is skipped.
- **Transfer markers** are saved before each step; a dead run's marker rolls back to
  `EMAIL_FOUND` once, an invalid ZIP is downloaded once more and then a new attempt starts.
- **Cancel** is honoured at the next boundary: before the click, at a transfer marker, or at
  the next tick.
- **Supervised incidents** (`NOTION_UI_CHANGED`, `UNKNOWN_ERROR` and the like) wake once after
  1 minute; with no supervisor yet, they then go to you like any other incident.

**Export size check.** At the transition to `COMPLETE`, the backup is compared with the newest
earlier `COMPLETE` job. Below `EXPORT_SHRINK_RATIO` (default `0.5`) of its file count or size
(exactly half is fine; without a file count, only the size), `result.shrink` is saved, an
`export.shrunk` event is written, and the success message turns into a ⚠️. The job completes
either way. Without an earlier backup, an `export.size` event says there was nothing to compare.

**`BackupApplicationService`** holds what the MCP tools, the Telegram buttons and the cron will
call: `start` (the period from now in `BACKUP_TIME_ZONE`; an existing job is returned, and one
still `CREATED` gets its first wakeup published again, with the same token, in case the first
publish failed; `force` needs no active job), `process`, `retry` (from `NOTION_TRIGGER` after a click, a new export
attempt: "Retry from scratch"), `cancel`, `status` and `list`. `process`, `retry` and `cancel`
take the job's lease for 15 s while they write, so no tick interleaves, and a wakeup delivered
before its token is saved waits (503) instead of being dropped as stale.

**`dev:tick`** runs all of this locally, with `APP_ENV=dev`: the dev Redis prefix, the dev
Notion session and `_dev/<YYYY>/` in Drive. It publishes nothing, so run it again for each step;
it prints when the next one is due (5, 15, then every 30 minutes while it waits for the email).
A verified ZIP of this month already in `_dev/<YYYY>/` (from `dev:upload`) is adopted at once;
delete it in Drive first, or use `--start --force`, to see a real export.

Flow diagrams of the tick, the schedule token, the notifications and the daily cron:
[docs/backup-lifecycle.md](docs/backup-lifecycle.md).

## Worker And Daily Cron

**The worker**, `POST /api/jobs/process/[jobId]`, takes one signed QStash delivery. The
scheduler publishes each wakeup to `<APP_BASE_URL>/api/jobs/process/<jobId>` on the EU endpoint,
with the body `{ jobId, token, reason }`, the deduplication ID `<jobId>.<token>`, 3 retries,
and flow control `nba-<APP_ENV>` with parallelism 1. The worker checks the `Upstash-Signature`
against the raw body and `APP_BASE_URL` plus the request's path, with the current and the next
signing key, `exp` and `nbf` enforced. It never uses the Host header, nor the query: Vercel
routes `api/jobs/process/[jobId].ts` to `[jobId]?jobId=<segment>`, a query QStash never
signed. A refused signature is logged as `worker.unauthorized` with the path and the query's
keys. Only then does it parse the body, which must name the path's job. Its answers tell QStash what to do
(S3), and carry codes only, since QStash keeps a failed delivery's body in its DLQ:

| Case                                                                 | Response                                      |
| -------------------------------------------------------------------- | --------------------------------------------- |
| Step done, waiting, a recorded failure, a stale token, an ended job  | `200`                                         |
| No genuine signature for this URL and body                           | `401 INVALID_SIGNATURE`                       |
| A body the app never sends, or one naming another job                | `489 INVALID_MESSAGE`, non-retryable          |
| An unknown job, or a stored record that fails its schema             | `489 JOB_NOT_FOUND` / `STATE_SCHEMA_INVALID`  |
| Another worker holds the lease                                       | `503 LEASE_HELD` + `Retry-After`              |
| The signing keys, `APP_BASE_URL`, Redis or the backup config missing | `503 CONFIG_INCOMPLETE`                       |
| Redis failed, or the next wakeup could not be published              | `500 WORKER_FAILED`; QStash retries the token |

The reserved job ID `_ping` only records the delivery's nonce in `health` (`qstashPing`): the
deployed smoke test, `smoke:qstash`. It needs the signing keys, `APP_BASE_URL` and Redis, not
the backup configuration.

**The daily cron**, `GET /api/cron/daily` at 04:00 UTC, needs `Authorization: Bearer
$CRON_SECRET`, which Vercel Cron sends by itself; anything else gets 401. Vercel Cron runs on
UTC, so that is 05:00 or 06:00 in Europe/Warsaw; the period, the auto-start day and the probe
days all use the local date in `BACKUP_TIME_ZONE`. In order:

1. Records the run in `health` (`cron`), which also keeps the Redis database active.
2. Auto-starts this month's job (`kind: scheduled`) when `AUTO_START_ENABLED=true`, the local
   day is `BACKUP_DAY_OF_MONTH` or later, and no job is active. The period's job, once it exists,
   is never started again.
3. The watchdog: an active job whose next wakeup is more than an hour late (or missing while
   something is due) gets a new one, and a job past its 168 h lifetime is woken so its tick
   ends it as `FAILED` with the ❌. Both go through `backup_process`'s path, under the 15 s
   control lease. A job that waits for you is never polled.
4. Probes, all at once, so the slowest budget (Notion's 120 s) bounds the run, not their sum:
   Google (a token refresh with both scopes, then Gmail's profile) and Drive (the root,
   this period's year folder, and a probe file created and deleted under `_dev/<YYYY>`) daily,
   and Notion (the gate, then Settings up to the export dialog, cancelled) on Mondays, two
   calendar days before `BACKUP_DAY_OF_MONTH`, and while a job waits for the Notion login.
   After any cookie refresh, the Notion probe reloads the saved session and requires an
   unexpired `file_token` for the download host. An unusable persisted cookie keeps the login
   failure, including when the browser renewed it but the save failed.
   Each result, pass or code, goes into `health`. A Drive probe file that cannot be deleted is
   logged by ID; the probe then reports the delete's own code (`GOOGLE_AUTH_REQUIRED`,
   `DRIVE_UNAVAILABLE`), and `DRIVE_ROOT_INACCESSIBLE` only when Drive refused it.
5. A probe that finds a login gone that it did not already find gone sends one 🔑 "access is
   gone" (Google, Notion, or the Drive folder). A probe that passes resumes a job that waits
   for that login, as `backup_retry` would: the Google fix needs no `backup_retry` either.
   The retry is for the incident read before the probe, checked again under the job's lease,
   so a newer incident that replaced it in the meantime is left for you.
6. Warns 30, 7 and 1 days (`LOGIN_WARNING_DAYS`) before the Notion sign-in's recorded expiry,
   once each (`notify:warning:notion:<expiresAt>:<days>`). After missed days, only the nearest
   threshold is sent. A rolling refresh that moves the expiry starts over.
7. Pings `HEARTBEAT_PING_URL`, or `<url>/fail` when a sub-step threw (5 s timeout; its own
   failure is only logged). With the check's period and grace at 1 day, healthchecks.io alerts
   through its own channel after 2 days of silence.

A sub-step that throws is logged and skipped; the run answers 500 with the report naming it.
A 500 therefore does not mean nothing ran: the report says which steps failed. Vercel Cron does
not retry it; the next run is the next day.
With nothing active and auto-start off, the cron publishes nothing to QStash.

`?probe=notion|google|drive` runs only that probe, records it, and returns its content-free
result, such as `{"ok":true,"probe":"notion","notionSession":"valid","exportDialog":"ready"}`
or `{"ok":false,"probe":"google","code":"GOOGLE_AUTH_REQUIRED"}`.

## Notifications And Telegram

`NOTIFIERS` (default `console`) lists the channels, behind a `CompositeNotifier` that sends to
all at once and logs a failing one as `notify.failed` with its name and error code only:

- **`console`**: one log line each, `notify.success`, `notify.failure`, `notify.attention` or
  `notify.login`, with a one-line `text`.
- **`telegram`**: your private chat with the bot, in HTML. It needs `TELEGRAM_HUB_URL` and
  `TELEGRAM_HUB_TOKEN`; without them it is left out with a `notify.telegram.unconfigured`
  warning, and `doctor` names what is missing.

| Event                     | Message                                                         | Buttons                                                                                 |
| ------------------------- | --------------------------------------------------------------- | --------------------------------------------------------------------------------------- |
| Backup stored             | ✅ size, file count, file name, folder, duration                | Open in Drive                                                                           |
| Backup stored, but shrunk | ⚠️ both file counts and sizes; "Check what the export covers"   | Open in Drive · Status                                                                  |
| Needs attention           | ⚠️ stage, code, reason, fix, supervisor summary, last 10 events | Status · Retry · Retry from scratch (while allowed) · Cancel; Fix login for login codes |
| Failed (lifetime)         | ❌ stage, code, reason                                          | Status                                                                                  |
| Login expiring / lost     | 🔑 the date or "access is gone", and the fix                    | Fix login                                                                               |

- **Safe content:** messages are built from the notifications' allowlisted fields. Every value
  is redacted and HTML-escaped, and free text loses every URL; the Drive link is a button, the
  only URL a message carries. No token, cookie, email content or mailbox address.
- **No repeats:** an attention is sent once per job and code per 24 h, a "lost" login warning
  once per service per 24 h (`notify:<key>` with `SET NX EX`).
- **Recorded:** every notification sent is also a `notification` event in `events:<jobId>`,
  since Hobby keeps logs for an hour; a login warning, which belongs to no job, is recorded in
  `health`. Nothing here ever fails the tick.
- **Sent once, even after a crash:** a job's success or failure is sent only while no
  `notification` event of that status exists. A delivery that finds the job ended, or waiting
  for you with its token still current, sends what a worker that died before notifying left
  unsent.
- **Other environments** are marked: a dev message starts with "🧪 dev".
- The buttons answer once the webhook exists; until then, tapping one does nothing.

**Setup:** the universal bot **Artsem Automation Hub** (`@artsem_automation_bot`) is owned by
the independent [telegram-webhook-hub](../telegram-webhook-hub/README.md) application and Vercel
project. Configure this backup app's `TELEGRAM_HUB_URL` and a dedicated `TELEGRAM_HUB_TOKEN`
(at least 32 characters). The same token authenticates this integration in the hub registry.
Register the backup endpoint `https://<backup-app>.vercel.app/api/integrations/telegram` with
ID `nb-prod` and commands `status` and `backup_status`. Add `telegram` to `NOTIFIERS`, then run
`pnpm --filter notion-backup-automation cli telegram:setup --test` to prove authenticated
outbound delivery. The backup app never receives the bot token, chat ID or webhook secret.

### Telegram Integration

`POST /api/integrations/telegram` receives only authenticated hub requests:

1. `Authorization: Bearer <TELEGRAM_HUB_TOKEN>` is compared in constant time before any
   services or payload are read. Invalid credentials receive 401.
2. Parse the strict shared `{ updateId, input }` protocol. Raw Telegram updates, extra fields,
   invalid input and oversized bodies are refused. The hub already checked Telegram's
   webhook secret, owner chat and sender; the backup application does not trust raw updates.
3. Claim a 60-second processing lease atomically. An unfinished concurrent delivery gets a
   retryable 503; a completed receipt gets 200 without applying an action twice. Successful
   processing stores a completed receipt for two days. Expired leases can be retried; release
   and completion compare the owner token so an old invocation cannot alter a newer lease.
4. Mutations save an allowlisted reply receipt before contacting the hub. Redelivery replays
   that receipt instead of running the mutation again. An immutable intent binds the action
   to the job version read before mutation, preventing a later incident from being retried
   when receipt storage itself failed. Confirmation leases preserve pending second taps
   through temporary failures and consume them only after completion or a domain refusal.
5. Domain refusals are replied with their safe code/message. Transport or scheduling failures
   release the lease and return 503 so the hub can retry. The hub owns the ingress hourly
   limit, so redeliveries do not consume a second backend quota.
6. A reply the hub refuses for good (any 4xx but 408 and 429, such as `422 TELEGRAM_REJECTED`)
   finishes the update as `rejected` and logs `telegram.rejected`: a resend would only fail the
   same way. A tap is answered only once handling ends for good, so after a temporary failure
   the resent update shows the real notice; Telegram accepts one answer per tap.

All sends, callback answers and button edits use authenticated `POST /api/messages` on the
hub. The hub chooses the owner chat. The HTTP client adds `nb-<APP_ENV>:` (or the configured
`TELEGRAM_INTEGRATION_ID`) to every outgoing callback and validates the full 64-byte budget;
this namespace must equal the route's `id` in the hub's `HUB_INTEGRATIONS`, or the hub refuses
buttons with 403. `doctor` checks the token with an authenticated `GET /api/messages`, which the
hub answers with 405 and a wrong token with 401; it never calls the hub's public health route.
The hub removes that routing prefix before forwarding a callback. An unconfigured development
route is refused instead of falling through to production. The hub's legacy integration entry
continues routing old unprefixed report/confirmation buttons to production; existing messages
do not require replacement.

| You send or tap                     | The bot                                                                                                                             |
| ----------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------- |
| `/status`, `/backup_status`, Status | Replies with the job (the given one, else the active or latest) as `backup_status` shows it, with the buttons its state allows.     |
| Retry                               | `backup_retry` from the failed stage, then removes the report's buttons.                                                            |
| Retry from scratch                  | Asks "Tap again to confirm" with one button (`telegram:confirm:<nonce>`, 10 min, single use); that tap retries from NOTION_TRIGGER. |
| Cancel                              | The same second tap, then `backup_cancel` with "Cancelled from Telegram".                                                           |
| Fix login                           | Replies with the command: `auth:notion`, `auth:google` (then Vercel and a redeploy), or `drive:check` for the folder access.        |
| Anything else                       | A short help text. The bot cannot start a backup or talk to a model.                                                                |

A button acts on the job's state now: one whose job moved on answers "Job 2026-10 is already
COMPLETE" (or that there is nothing to retry) and changes nothing.

**Webhook ownership:** only `pnpm --filter telegram-webhook-hub cli telegram:setup` can
register `https://telegram-webhook-hub.vercel.app/api/webhook`. Inspect it with that command's
`--info` mode first. The hub refuses another registered URL without explicit `--replace` and
preserves pending updates. This application's `telegram:setup --test` sends through the hub; configuration modes
print the hub command. It cannot register a competing webhook. The old backup `/api/telegram/webhook`
entrypoint has been migrated to the integration endpoint.

## MCP Server

`POST /mcp` is a remote MCP server over Streamable HTTP, stateless: a new server answers each
request, for 2026-07-28 clients and, through the SDK's stateless fallback, 2025 clients. In
order: `Authorization: Bearer $MCP_AUTH_TOKEN` (constant time; 401 with `WWW-Authenticate:
Bearer`), the `Origin` rule (a request with an `Origin` not in `MCP_ALLOWED_ORIGINS`, empty by
default, gets 403), `POST` only (405), and at most 60 requests an hour (429 with `Retry-After`).
There is no unauthenticated path to any tool.

| Tool             | Does                                                                                                   |
| ---------------- | ------------------------------------------------------------------------------------------------------ |
| `backup_start`   | This month's job, returned at once in `CREATED`; idempotent per month. `force` starts `<period>-r<N>`. |
| `backup_status`  | One job (default: the active, else the latest) with its result or what needs attention, and 10 events. |
| `backup_list`    | The newest jobs first (`limit` 1–24, default 12).                                                      |
| `backup_process` | Wakes a job now (a new token, an immediate wakeup); at most 10 calls per job per hour.                 |
| `backup_retry`   | Resumes a job that needs attention or waits to retry, from its stage or `fromStage`.                   |
| `backup_cancel`  | Cancels a job that has not ended, with a reason.                                                       |
| `backup_health`  | The stored probe results, the last QStash ping and cron run, and the agent and notification settings.  |

Each result carries `structuredContent` and a text block with a one-line summary and the same
JSON. A refusal is `isError: true` with `{ code, message }`: `ACTIVE_JOB_EXISTS`, `JOB_NOT_FOUND`,
`INVALID_STATE`, `RATE_LIMITED`, `SCHEDULER_UNAVAILABLE`, or `INTERNAL_ERROR` (details only in
the logs). The views are built field by field from an allowlist: no URL, token, cookie, email
content, schedule token or Drive folder ID can reach a client.

### MCP Client Setup

`NOTION_BACKUP_MCP_TOKEN` is your shell's copy of `MCP_AUTH_TOKEN` (`openssl rand -base64 32`,
from 1Password). Claude Code, user scope:

```sh
claude mcp add --transport http --scope user notion-backup https://<app>.vercel.app/mcp --header "Authorization: Bearer $NOTION_BACKUP_MCP_TOKEN"
```

Cursor and Codex take the same URL with an `Authorization` header (Codex:
`bearer_token_env_var = "NOTION_BACKUP_MCP_TOKEN"`). To remove it:
`claude mcp remove notion-backup --scope user`.

## State In Redis

Every key starts with `{nba:<APP_ENV>}:`, so `prod`, `dev` and `test` share the
`notion-backup-state` database without overlap. The braces are a hash tag that keeps one
environment's keys in one slot for the Lua scripts.

| Key                           | Content                                                                                                                                   |
| ----------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------- |
| `job:<jobId>`                 | Hash `{ v, data }`: the compare-and-set version and the job JSON                                                                          |
| `jobs`                        | Sorted set of job IDs by `createdAt`                                                                                                      |
| `active`                      | The one active job ID; cleared when the job reaches a terminal status                                                                     |
| `lease:<jobId>`               | The worker holding the job (`SET NX PX`)                                                                                                  |
| `events:<jobId>`              | The newest 200 sanitized events                                                                                                           |
| `email:<messageId>`           | The job that consumed this export email                                                                                                   |
| `secret:notion-storage-state` | The AES-256-GCM envelope of the Notion session                                                                                            |
| `health`                      | The last result of each probe, the last cron run, the `_ping` nonce, and the last login warning                                           |
| `notify:<key>`                | A notification that must not repeat yet (`SET NX EX`): 24 h, or until a day after a Notion expiry for `warning:notion:<expiresAt>:<days>` |

A normal job's ID is its period (`2026-10`), so `job:<period>` is also the
one-normal-job-per-period guard. A forced job is `<period>-r<N>`.

## Health Check

`GET /api/health` → `200 {"ok":true,"version":"<short commit SHA>"}` with `Cache-Control: no-store`.
The version is `unknown` outside a Vercel Git deployment. The endpoint is public, so it returns
nothing else.

## Vercel Project

The project imports this repository from GitHub:

| Setting                                                              | Value                                           |
| -------------------------------------------------------------------- | ----------------------------------------------- |
| Framework Preset                                                     | Other                                           |
| Root Directory                                                       | `workspaces/apps/notion-backup-automation`      |
| Include source files outside of the Root Directory in the Build Step | On                                              |
| Build, install and output settings                                   | Defaults                                        |
| Node.js version                                                      | 24.x (pinned by `engines` in `package.json`)    |
| Function region                                                      | `fra1` (from `vercel.json`)                     |
| Environment variables                                                | Production only (see [Deployment](#deployment)) |

Vercel compiles each `api/*.ts` file and resolves imports with plain Node.js rules; it does
not bundle. The app's `vercel-build` script first builds `@workspaces/telegram-contracts`, whose
runtime exports point to JavaScript in `dist/`. `pnpm install` also builds that package for local
CLI and test use; after schema changes or an install with `--ignore-scripts`, run
`pnpm --filter @workspaces/telegram-contracts build` before using either app.

The functions must not import the repo's `@workspaces/packages/*` packages: Node.js cannot resolve
a package name with three segments (`ERR_UNSUPPORTED_DIR_IMPORT`), and the sibling apps only use
those packages through esbuild bundles or `tsx`.

`vercel.json` gives the worker and the cron 300 s, and includes Chromium's archives in both,
since the package finds them at runtime, next to its own code (S2). The pattern names pnpm's
real path, `../../../node_modules/.pnpm/@sparticuz+chromium@*/node_modules/@sparticuz/chromium/bin/**`:
through the app's `node_modules/@sparticuz/chromium` symlink, Vercel rejects the function
("files in symlinked directories"). The cron entry runs `/api/cron/daily` daily at 04:00 UTC.

## Deployment

Secrets exist only in the **Production** environment. Previews get none, so every function but
`/api/health` fails closed with 503 `CONFIG_INCOMPLETE`. The first time (and after any change of
a variable, which applies to new deployments only):

1. **Variables.** Add to Vercel → Settings → Environment Variables, Production only, from
   1Password; mark each secret Sensitive:
   - secrets: `UPSTASH_REDIS_REST_URL`, `UPSTASH_REDIS_REST_TOKEN`, `APP_ENCRYPTION_KEY`,
     `QSTASH_TOKEN`, `QSTASH_CURRENT_SIGNING_KEY`, `QSTASH_NEXT_SIGNING_KEY`, `GOOGLE_CLIENT_ID`,
     `GOOGLE_CLIENT_SECRET`, `GOOGLE_REFRESH_TOKEN`, `GEMINI_API_KEY`, `CRON_SECRET`,
     `TELEGRAM_HUB_TOKEN`, `HEARTBEAT_PING_URL`, and from Phase 8 `MCP_AUTH_TOKEN`;
   - plain: `APP_ENV=prod`, `QSTASH_URL=https://qstash-eu-central-1.upstash.io`,
     `GOOGLE_DRIVE_BACKUP_ROOT_FOLDER_ID`, `NOTION_WORKSPACE_URL`, `NOTION_WORKSPACE_NAME`,
     `TELEGRAM_HUB_URL=https://telegram-webhook-hub.vercel.app`, `TELEGRAM_INTEGRATION_ID=nb-prod`,
     `NOTIFIERS=console,telegram`, `AUTO_START_ENABLED=false`.

   `CRON_SECRET` is `openssl rand -base64 32`; `HEARTBEAT_PING_URL` is the ping URL of a
   healthchecks.io check with period 1 day and grace 1 day. `GEMINI_API_KEY` is required while
   `AGENT_MODEL_PROVIDER` is `gemini` (the default), though nothing calls Gemini yet.

2. **Deploy:** merge to `main`. Take the production URL and set `APP_BASE_URL` to it (an
   origin, no trailing slash), then **Redeploy**: QStash destinations and the worker's
   signature check both use it.
3. **Notion session for prod:** with `APP_ENV=prod` and the production Redis credentials in
   `.env.local`, run `APP_ENV=prod pnpm --filter notion-backup-automation auth:notion`.
4. **Smoke tests**, with `CRON_SECRET` from 1Password in your shell:

   ```sh
   curl -s https://<app>.vercel.app/api/health
   curl -si -X POST https://<app>.vercel.app/api/jobs/process/_ping
   curl -si https://<app>.vercel.app/api/cron/daily
   APP_ENV=prod pnpm --filter notion-backup-automation cli smoke:qstash
   curl -s -H "Authorization: Bearer $CRON_SECRET" "https://<app>.vercel.app/api/cron/daily?probe=notion"
   curl -s -H "Authorization: Bearer $CRON_SECRET" "https://<app>.vercel.app/api/cron/daily?probe=google"
   curl -s -H "Authorization: Bearer $CRON_SECRET" "https://<app>.vercel.app/api/cron/daily?probe=drive"
   ```

   Expect `{"ok":true,…}`, then 401 for the unsigned worker call and the cron without the
   secret, "ping delivered and verified", `"notionSession":"valid"` with `"exportDialog":"ready"`,
   both scopes for Google, and `"ok":true` for Drive. `NBA_LIVE_REDIS=1 … test:live` checks
   Redis itself.

5. **Heartbeat:** after the first scheduled cron run, the healthchecks.io check shows a ping
   and is "up".
6. **MCP and the complete Telegram migration (Phase 8):** generate separate `MCP_AUTH_TOKEN`
   and `TELEGRAM_HUB_TOKEN` values (`openssl rand -base64 32` each), store in 1Password and
   Production as Sensitive, then deploy both applications. Follow the hub's [deployment
   runbook](../telegram-webhook-hub/README.md) for its bot token, owner chat, webhook secret,
   integration registry and separate Redis namespace. These bot credentials belong only to
   the hub. Configure this app's hub URL/integration ID and match the dedicated token in the
   hub registry before enabling notifications.

   ```sh
   curl -si -X POST https://<app>.vercel.app/mcp
   curl -si -X POST https://<app>.vercel.app/api/integrations/telegram
   curl -si -X POST https://telegram-webhook-hub.vercel.app/api/webhook
   curl -si -X POST https://telegram-webhook-hub.vercel.app/api/messages
   pnpm --filter telegram-webhook-hub cli telegram:setup --info
   pnpm --filter telegram-webhook-hub cli telegram:setup
   pnpm --filter notion-backup-automation cli telegram:setup --test
   ```

   Unauthenticated calls receive 401 once configuration is present; previews without secrets
   fail closed. Only the hub registers the webhook; when intentionally replacing another URL,
   use its explicit `--replace` mode. Send `/status` and `/backup_status`, tap both old and new
   Status buttons, exercise Retry, Fix login (Notion/Google/Drive), Cancel and Retry from
   scratch with their second taps. Verify success/failure/attention/login-warning delivery,
   duplicate updates, temporary backend unavailability and environment isolation. All these
   checks are Phase 8 acceptance; no existing Telegram migration is deferred.

   Add the MCP client ([MCP Client Setup](#mcp-client-setup)): `tools/list` shows 7 tools,
   `backup_list` returns persisted jobs, and `backup_health` reports hub configuration and
   fresh probe results. Inspect deployed function bundles: the hub has no backup/Google/
   Playwright dependencies.

Real backups start only through an explicit start (`backup_start` from an MCP client), or
through the cron once `AUTO_START_ENABLED=true`.
