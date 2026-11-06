# Backup lifecycle

[Setup, limits and recovery](../README.md) live in the README. Notion's browser work is shown
in [Notion export and login](notion-export-flow.md).

## Job States

The normal path, including transfer progress markers. `DOWNLOADING`, `VERIFYING` and `UPLOADING`
run inside one invocation, not separate ticks.

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

A verified Drive backup can complete the job before export or transfer. Forced jobs only adopt
their own job ID. Link expiry or two invalid transfers can start another export only while
attempts remain. See [job rules](../src/domain/job-lifecycle.ts) and
[transitions](../src/domain/transitions.ts).

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

Supervised incidents make one decision per wakeup, within the
[supervisor's limits](../README.md#supervisor). Once handed to an operator, they have no scheduled
polling; a login fix can also resume them. Lifetime expiry is checked at the next tick, including
when the daily watchdog wakes an expired job.

## One Tick — `ProcessJobUseCase.execute`

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

The lease is released in `finally`, including stale deliveries and failures. Heavy steps have
270 s to start work inside the 300 s function limit; light steps have 45 s. Redis writes use
compare-and-set. Source: [process-job.ts](../src/application/process-job.ts) and
[next-step.ts](../src/domain/next-step.ts).

## Schedule Token — Publish, Then Save

Only a wakeup matching the job's current schedule token can advance it.

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

- Publishing first prevents a saved schedule with no message. A published token never saved is stale.
- When no work remains scheduled, the token is cleared.
- Redis or publish failures return 500 so QStash retries. The daily watchdog re-arms missing
  or overdue wakeups.

## Daily Cron — `DailyMaintenance.run`

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

Thrown sub-step failures produce HTTP 500 and a `/fail` heartbeat. A failed access probe is a
recorded result and does not necessarily fail the cron. A passing probe resumes only the matching
login incident, rechecked under the job's lease. Settings are in
[daily maintenance and login renewal](../README.md#daily-maintenance-and-login-renewal).
