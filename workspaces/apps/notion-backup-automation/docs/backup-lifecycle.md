# notion-backup-automation — Job States, Ticks, Notifications and the Daily Cron

Workflow diagrams for the [notion-backup-automation workspace](../). Behavior, codes and
limits are in the [README](../README.md#backup-jobs); the Notion steps inside a tick are in
[notion-export-flow.md](notion-export-flow.md). Structure-level view: the
[repository C4 workspace](../../../../docs/architecture/workspace.dsl).

## Job States

The happy path, one step per tick. `DOWNLOADING`, `VERIFYING` and `UPLOADING` are progress
markers inside one transfer run, not tick entry points. Source of truth:
`src/domain/transitions.ts`.

```mermaid
stateDiagram-v2
  direction LR
  [*] --> CREATED
  CREATED --> TRIGGERING_EXPORT
  TRIGGERING_EXPORT --> WAITING_FOR_EMAIL: export requested
  WAITING_FOR_EMAIL --> EMAIL_FOUND: trusted email claimed
  WAITING_FOR_EMAIL --> TRIGGERING_EXPORT: email timeout (default 48 h)
  EMAIL_FOUND --> DOWNLOADING
  DOWNLOADING --> VERIFYING
  VERIFYING --> UPLOADING
  UPLOADING --> COMPLETE
  VERIFYING --> TRIGGERING_EXPORT: ZIP invalid twice
  EMAIL_FOUND --> TRIGGERING_EXPORT: link expired
  TRIGGERING_EXPORT --> COMPLETE: Drive already has it
  EMAIL_FOUND --> COMPLETE: Drive already has it
  COMPLETE --> [*]
```

Not shown, to keep the diagram readable:

- The email timeout is `EMAIL_WAIT_TIMEOUT_HOURS` (default 48 h); the lifetime limit is
  `JOB_MAX_LIFETIME_HOURS` (default 168 h).
- A dead or over-budget transfer run rolls back to `EMAIL_FOUND` once. A link that expires
  during the download also starts a new export attempt.
- A new export attempt (back to `TRIGGERING_EXPORT`) needs attempts left
  (`MAX_EXPORT_ATTEMPTS`); otherwise the job needs attention.
- Any working status can fail as below; any non-terminal status can end as `CANCELLED` or
  `FAILED` (lifetime).

## Failures And Incidents

```mermaid
flowchart LR
  Fail[A step fails<br/>with a code] --> Budget{Retryable and<br/>budget left?}
  Budget -->|yes| Retryable[RETRYABLE_FAILURE]
  Retryable -->|backoff 5 m … 6 h| Resume[Back to the<br/>stage's entry status]
  Budget -->|no| Attention[NEEDS_ATTENTION:<br/>notify you]
  Attention -->|backup_retry, Telegram Retry,<br/>or a fixed login| Resume
  Attention -->|backup_cancel| Cancelled([CANCELLED])
  Lifetime[Job lifetime exceeded<br/>default 168 h] --> Failed([FAILED])
```

Supervised codes (such as `NOTION_UI_CHANGED`) first wait one minute for the supervisor; with
no supervisor built yet, the next tick hands them to you.

## One Tick — `ProcessJobUseCase.execute`

Each wakeup runs exactly one step. A Redis failure or a failed publish of the next wakeup
throws, so QStash retries the same delivery with the same token.

```mermaid
flowchart TD
  Wakeup([Wakeup: job ID + token]) --> Load{Job stored<br/>and not ended?}
  Load -->|no| Gone([not_found, or terminal:<br/>send an unsent final notification])
  Load -->|yes| Idle{Waiting for you<br/>with this token?}
  Idle -->|yes| Noop([done: no lease needed])
  Idle -->|no| Lease{Lease free?<br/>60 s light, 330 s heavy}
  Lease -->|no| Held([lease_held: 503 + Retry-After])
  Lease -->|yes| Token{Token still current<br/>after reload?}
  Token -->|no| Stale([stale: do nothing])
  Token -->|yes| Step["nextStep: cancel → lifetime →<br/>orphan rollback → status step"]
  Step --> Notify[Save with compare-and-set,<br/>then notify]
  Notify --> Next[Publish the next wakeup with a new token,<br/>then save it; or clear the token]
  Next --> Done([Release the lease])
```

## Schedule Token — Publish, Then Save

A delivery runs only with the job's current token. Publishing first and saving second means a
failed publish leaves the delivered token valid for QStash's retry, and a failed save leaves
only a stale message behind.

```mermaid
sequenceDiagram
  participant Q as QStash
  participant W as Worker tick
  participant R as Redis
  Q->>W: wakeup (T1)
  W->>R: lease, reload: token T1 is current
  W->>R: save the step's transitions (compare-and-set)
  W->>Q: publish the next wakeup with T2
  alt publish fails
    W-->>Q: 500: Q retries T1, still current
  else publish succeeds
    W->>R: save schedule.token = T2
    alt save fails
      W-->>Q: 500: Q retries T1, which re-arms
      Q->>W: wakeup (T2) later: stale, does nothing
    else save succeeds
      W-->>Q: 200
      Q->>W: wakeup (T2) when due
    end
  end
```

## Notifications — `JobNotifications`

Nothing in this path throws: a failed channel, gate or event write is logged and the tick goes
on.

```mermaid
flowchart LR
  Event[success · failure ·<br/>attention · login warning] --> Gate{attention: first for this<br/>job and code in 24 h?<br/>lost login: first for this service?}
  Gate -->|no| Skip([skipped])
  Gate -->|yes| Fan[CompositeNotifier:<br/>console + Telegram]
  Fan -->|a channel fails| Logged[notify.failed:<br/>name and code only]
  Fan --> Record[Event in events:jobId,<br/>or health for a login warning]
```

## Daily Cron — `DailyMaintenance.run`

A sub-step that throws is logged and skipped, and turns the heartbeat into `/fail`. With no
active job and auto-start off, nothing is published. A probe resumes only the incident it read
before probing, re-checked under the job's lease.

```mermaid
flowchart TD
  Cron([Vercel Cron, Bearer CRON_SECRET]) --> Touch[Record the run in health]
  Touch --> Start{Auto-start on, due,<br/>no active job?}
  Start -->|yes| Create[Start this month's job]
  Start -->|no| Watch
  Create --> Watch{Active job's wakeup over an<br/>hour late, or past its lifetime?}
  Watch -->|yes| Rearm[New token and wakeup<br/>under the control lease]
  Watch -->|no| Probes
  Rearm --> Probes["Probe in parallel: Google and Drive daily;<br/>Notion on Mondays, 2 days before the backup day,<br/>or while a job waits for its login"]
  Probes -->|a probe passes| Resume[Resume a job waiting<br/>for that login]
  Probes -->|a login newly gone| Lost[🔑 access is gone]
  Resume --> Warn
  Lost --> Warn["🔑 Notion session expiry:<br/>30, 7, 1 days, once each"]
  Warn --> Beat{Any sub-step threw?}
  Beat -->|no| Ok([Heartbeat ping])
  Beat -->|yes| Fail([Heartbeat /fail])
```
