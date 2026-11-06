# notion-backup-automation — Job States, Ticks and the Daily Cron

Workflow diagrams for the [notion-backup-automation workspace](../). Behavior, codes and limits
are in the [README](../README.md#backup-jobs); the Notion steps inside a tick are in
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
  WAITING_FOR_EMAIL --> NEEDS_ATTENTION: email timeout (default 48 h)
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

- Any working status can fail into `RETRYABLE_FAILURE` or `NEEDS_ATTENTION` (next section); any
  non-terminal status can end as `CANCELLED`, or as `FAILED` when the lifetime
  (`JOB_MAX_LIFETIME_HOURS`, default 168 h) runs out.
- A dead or over-budget transfer run rolls back to `EMAIL_FOUND` once. A link that expires during
  the download also starts a new export attempt.
- A new export attempt (back to `TRIGGERING_EXPORT`) needs attempts left (`MAX_EXPORT_ATTEMPTS`);
  otherwise the job needs attention.

## Failures And Incidents

```mermaid
flowchart LR
  Fail[A step fails<br/>with a code] --> Budget{Retryable and<br/>budget left?}
  Budget -->|yes| Retryable[RETRYABLE_FAILURE]
  Retryable -->|backoff 5 m … 6 h| Resume[Back to the<br/>stage's entry status]
  Budget -->|no| Attention[NEEDS_ATTENTION]
  Attention --> Supervised{Supervised code?}
  Supervised -->|yes| Supervisor[Supervisor decision<br/>after 1 min]
  Supervised -->|no| User[Notify you]
  Supervisor -->|retry stage or new export| Resume
  Supervisor -->|inspect, check, search, wait| Supervisor
  Supervisor -->|handover or budget spent| User
  User -->|backup_retry, Telegram Retry,<br/>or a fixed login| Resume
  User -->|backup_cancel| Cancelled([CANCELLED])
  Lifetime[Job lifetime exceeded<br/>default 168 h] --> Failed([FAILED])
```

Supervised codes (such as `NOTION_UI_CHANGED`) first wait one minute for the
[supervisor](../README.md#supervisor), which makes one bounded decision per wakeup. Inspection
actions wake again after one minute; `wait` defers the next decision for 15, 60 or 240 minutes.
With `AGENT_MODEL_PROVIDER=none`, the next tick hands the incident to you without an LLM call.
Once an incident waits for you, nothing more is scheduled.

## One Tick — `ProcessJobUseCase.execute`

Each wakeup runs exactly one step. A Redis failure or a failed publish of the next wakeup throws,
so QStash retries the same delivery with the same token.

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

Every job keeps one **current token** (`schedule.token`), and every QStash wakeup carries a
token. A wakeup does work only if its token matches the job's. Each new wakeup gets a new token,
so duplicate, late or replaced wakeups do nothing.

Follow one wakeup from arrival to answer:

```mermaid
flowchart TD
  Msg([QStash delivers a wakeup<br/>carrying token T1]) --> Check{Does T1 match the<br/>job's current token?}
  Check -->|no| Stale([Stale: do nothing, 200])
  Check -->|yes| Run[Run one step, save the job]
  Run --> Pub{Publish the next wakeup<br/>with a new token T2}
  Pub -->|fails| Retry1([500: QStash redelivers T1.<br/>T1 still matches, so the tick runs again])
  Pub -->|ok| Save{Save T2 as the<br/>job's current token}
  Save -->|fails| Retry2([500: QStash redelivers T1, which still matches.<br/>T2 will arrive stale and do nothing])
  Save -->|another call changed<br/>the token first| Other([200: T2 will arrive stale.<br/>The other call's wakeup is the live one])
  Save -->|ok| Done([200: T2 wakes the job when due])
```

**Why publish before saving:** a published wakeup whose token was never saved is harmless: it
arrives stale. A saved token whose wakeup was never published would leave the job asleep for
good. When the job needs no wakeup (it waits for you), the token is cleared instead, so any late
wakeup is stale.

## Daily Cron — `DailyMaintenance.run`

A sub-step that throws is logged and skipped, and turns the heartbeat into `/fail`. A probe
resumes only the incident it read before probing, re-checked under the job's lease.

```mermaid
flowchart TD
  Cron([Vercel Cron, Bearer CRON_SECRET]) --> Touch[Record the run in health]
  Touch --> Start[Auto-start this month's job<br/>if enabled, due and idle]
  Start --> Watch[Watchdog: re-arm a wakeup over an hour late,<br/>wake a job past its lifetime]
  Watch --> Probes["Probe Google and Drive daily;<br/>Notion on Mondays, 2 days before the backup day,<br/>or while a job waits for its login"]
  Probes -->|probe passes| Resume[Resume a job waiting<br/>for that login]
  Probes -->|access newly lost| Lost[🔑 access is gone]
  Probes -->|Notion signed out,<br/>auto-login on| Queue[Queue _notion-login]
  Resume --> Warn
  Lost --> Warn
  Queue --> Warn
  Warn["Warn 30, 7, 1 days before the Notion session expires<br/>(auto-login on: renew first, warn only if that fails)"] --> Beat{Any sub-step threw?}
  Beat -->|no| Ok([Heartbeat ping])
  Beat -->|yes| Fail([Heartbeat /fail])
```
