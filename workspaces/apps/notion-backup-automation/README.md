# notion-backup-automation

A backup agent that will request the official Notion workspace export every month and store
the ZIP in Google Drive. It runs as Vercel Functions.

**Status:** Google OAuth, the Drive access check and the Gmail export-email finder (Phase 2),
the Drive backup storage with its resumable uploader (Phase 3), the ZIP transfer from the
export link to Drive (Phase 4), and the Notion session bootstrap and export trigger with
Playwright (Phase 5), with a local CLI. The only function is still `GET /api/health`.

## Layout

| Path                        | Purpose                                                                                                                           |
| --------------------------- | --------------------------------------------------------------------------------------------------------------------------------- |
| `api/`                      | Vercel function entry points (Web `Request` → `Response`). No business logic.                                                     |
| `src/config/env.ts`         | Zod env schemas, one subset per function. Errors name the variables, never their values.                                          |
| `src/domain/`               | The job schema, statuses, transitions and lifecycle rules, schedule and retry policies, periods, naming, the error catalog. Pure. |
| `src/application/`          | The ports the adapters implement (`ports.ts`), and `IntegrationError`, which carries a cataloged error code.                      |
| `src/adapters/persistence/` | Upstash Redis adapters with Lua scripts (`lua/*.lua`), and the in-memory job repository.                                          |
| `src/adapters/google/`      | OAuth: loopback consent with PKCE, the Picker grant, the token provider, and the REST client shared by Gmail and Drive.           |
| `src/adapters/gmail/`       | The export-email finder and its parser: the trust checks and the download-link extraction.                                        |
| `src/adapters/drive/`       | The backup storage (year folders, verified uploads, the sidecar), the resumable uploader, and the S6 access check (C1–C4).        |
| `src/adapters/transfer/`    | The export transfer: the link hop, the cookie download to `/tmp/nba`, the ZIP verifier, and the upload through the storage.       |
| `src/adapters/notion/`      | Playwright: the browser launcher, the saved session, the session gate, the Settings page object, and the export trigger.          |
| `src/cli/`                  | The local CLI: `auth:google`, `auth:notion`, `drive:check`, `drive:init`, `doctor`, `dev:upload`, `dev:trigger`, `dev:download`.  |
| `src/shared/`               | The redacting JSON-line logger, envelope crypto (AES-256-GCM), the `.env.local` writer, masking, `SecretValue`, clock, IDs.       |
| `tests/`                    | Vitest. `tests/contract/` holds the repository contract; `tests/live/` and `tests/browser/` the opt-in suites; `tests/fixtures/`. |
| `vercel.json`               | Region and per-function limits.                                                                                                   |
| `.env.example`              | Template for the untracked `.env.local`.                                                                                          |

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
```

| Command                      | What it does                                                                                                                                                                                                                                                                                                                                                  |
| ---------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `auth:google`                | Opens Google consent for `gmail.readonly` and `drive.file` (Desktop client, loopback redirect on `127.0.0.1`, PKCE, `state`). Writes `GOOGLE_REFRESH_TOKEN` into `.env.local` (0600) and prints it masked. `--print` also prints the token itself, to paste into 1Password.                                                                                   |
| `auth:google --pick-folders` | S6 fallback 1: a separate `drive.file`-only consent with the Google Picker. Pick `Full Workspace` and the year folder; the grant belongs to the app, and this consent's token is discarded.                                                                                                                                                                   |
| `drive:check`                | S6: C1 the root is visible, C2 exactly one year folder is visible in it, C3 a file can be created and deleted in the root, C4 the same in the year folder. Exits 0 when C1 and C3 pass.                                                                                                                                                                       |
| `drive:init`                 | S6 fallback 2: creates the app-owned `Full Workspace` folder at the top of My Drive (once), and prints its ID and the manual steps.                                                                                                                                                                                                                           |
| `doctor`                     | Refreshes the Google token and lists its scopes, reads the masked mailbox, finds the newest trusted export email since `--email-since` (a day in `BACKUP_TIME_ZONE`; default: the last 30 days), checks the Drive root (C1), pings Redis, and opens the Notion session secret of `APP_ENV`. Exits 1 if a check fails; an expired Testing token names the fix. |
| `dev:upload`                 | Only with `APP_ENV=dev`. Uploads a local file as today's backup into `_dev/<YYYY>/` in the Drive root, through the same storage code the worker uses, and prints the Drive file ID, size, SHA-256 and the sidecar outcome. A second run with the same file uploads nothing. Exits 1 if the sidecar failed.                                                    |
| `auth:notion`                | Opens Chrome on Notion's login page; you sign in yourself, MFA included. Saves the session, encrypted, to Redis for `APP_ENV` and checks it again in a headless browser (see [Notion Session And Export](#notion-session-and-export)). Exits 1 if no cookie matches `file.notion.com`, since the export download needs one.                                   |
| `dev:trigger`                | Only with `APP_ENV=dev`. Requests one real workspace export in Notion's Settings with the saved session, so Notion sends its export email. `--dry-run` goes up to the dialog's Export button, sets the dialog values, and cancels. `--headed` shows the window. Exits 1 when the click was sent but no confirmation appeared.                                 |
| `dev:download`               | Only with `APP_ENV=dev`. Finds the newest trusted export email since `--email-since` (default: the last 7 days), downloads its ZIP with the saved session's cookies into a temporary directory, checks the signature and the archive, prints the size, SHA-256 and file count, and deletes the copy. Nothing is uploaded.                                     |

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
   icon's initial or emoji (`'` and `’` count as equal). A workspace whose name only contains
   it, such as "… Archive", fails.
2. Of the browser's `storageState()`, only Notion's cookies (`notion.com`, and any left on
   `notion.so`) and the localStorage of Notion's HTTPS origins are kept. An unexpired `token_v2`
   is required.
3. The state is saved as `secret:notion-storage-state`: Playwright's `storageState()` JSON as the
   AES-256-GCM-encrypted value, which the transfer reads its cookies from. The envelope's `meta`
   holds the replayed identity (user agent, locale, time zone, viewport), the earliest sign-in
   cookie expiry, and whether a cookie matches `file.notion.com`. No plaintext file is written.
4. A new headless context decrypts it and runs the gate again. The output prints
   `authenticated`, the expiry and the file-host match, never a cookie value.

**The session gate** judges the rendered page, since Notion answers `200` without a session:
its login page is `NOTION_SESSION_EXPIRED`; a CAPTCHA or verification page (Cloudflare,
hCaptcha, reCAPTCHA) is `NOTION_INTERACTIVE_CHALLENGE`; another workspace is
`NOTION_WRONG_WORKSPACE`; a failed load, a 5xx or an app that never renders is
`NOTION_UNAVAILABLE`. Each needs `auth:notion` and then `backup_retry`, except the last, which
is retried.

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

Each step waits up to 30 s (S2). An abort closes the browser at once. The serverless launcher
(`@sparticuz/chromium`) and writing back cookies Notion renews follow with the worker.

## State In Redis

Every key starts with `{nba:<APP_ENV>}:`, so `prod`, `dev` and `test` share the
`notion-backup-state` database without overlap. The braces are a hash tag that keeps one
environment's keys in one slot for the Lua scripts.

| Key                           | Content                                                               |
| ----------------------------- | --------------------------------------------------------------------- |
| `job:<jobId>`                 | Hash `{ v, data }`: the compare-and-set version and the job JSON      |
| `jobs`                        | Sorted set of job IDs by `createdAt`                                  |
| `active`                      | The one active job ID; cleared when the job reaches a terminal status |
| `lease:<jobId>`               | The worker holding the job (`SET NX PX`)                              |
| `events:<jobId>`              | The newest 200 sanitized events                                       |
| `email:<messageId>`           | The job that consumed this export email                               |
| `secret:notion-storage-state` | The AES-256-GCM envelope of the Notion session                        |
| `health`                      | The last result of each health probe                                  |

A normal job's ID is its period (`2026-10`), so `job:<period>` is also the
one-normal-job-per-period guard. A forced job is `<period>-r<N>`.

## Health Check

`GET /api/health` → `200 {"ok":true,"version":"<short commit SHA>"}` with `Cache-Control: no-store`.
The version is `unknown` outside a Vercel Git deployment. The endpoint is public, so it returns
nothing else.

## Vercel Project

The project imports this repository from GitHub:

| Setting                                                              | Value                                        |
| -------------------------------------------------------------------- | -------------------------------------------- |
| Framework Preset                                                     | Other                                        |
| Root Directory                                                       | `workspaces/apps/notion-backup-automation`   |
| Include source files outside of the Root Directory in the Build Step | On                                           |
| Build, install and output settings                                   | Defaults                                     |
| Node.js version                                                      | 24.x (pinned by `engines` in `package.json`) |
| Function region                                                      | `fra1` (from `vercel.json`)                  |
| Environment variables                                                | None yet                                     |

Vercel compiles each `api/*.ts` file and resolves imports with plain Node.js rules; it does
not bundle. So the functions must not import the repo's `@workspaces/packages/*` packages:
Node.js cannot resolve a package name with three segments (`ERR_UNSUPPORTED_DIR_IMPORT`), and
the sibling apps only use them through esbuild bundles or `tsx`. Import npm packages, or code
inside this app, instead.
