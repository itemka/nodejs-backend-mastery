# notion-backup-automation — Backup Job Tick, Wakeups, and Notifications

Workflow diagrams for the [notion-backup-automation workspace](../). Behavior is described in
the [README](../README.md#backup-jobs); the Notion steps inside a tick are in
[notion-export-flow.md](notion-export-flow.md).

Structure-level view: [repository C4 workspace](../../../../docs/architecture/workspace.dsl).

## One Tick — `ProcessJobUseCase.execute`

Each wakeup runs exactly one step. Redis failing, or the next wakeup failing to publish,
throws, so the same delivery is retried with the same token.

```mermaid
flowchart TD
  Wakeup([Wakeup: job ID + schedule token]) --> Load{Job stored?}
  Load -->|no| NotFound([not_found])
  Load -->|yes| Ended{Terminal?}
  Ended -->|yes| Recover[Send its success or failure<br/>if no notification event exists]
  Recover --> Terminal([terminal])
  Ended -->|no| Idle{Waits for you,<br/>and the token matches?}
  Idle -->|yes| Noop([done: no step, no lease;<br/>an unsent attention is sent])
  Idle -->|no| Lease{Lease free?<br/>60 s light, 330 s heavy}
  Lease -->|no| Held([lease_held: Retry-After])
  Lease -->|yes| Reload[Reload under the lease]
  Reload --> Token{Token still<br/>the job's?}
  Token -->|no| Stale([stale])
  Token -->|yes| Step["nextStep: cancel → lifetime → orphan<br/>rollback → the status's step"]
  Step --> Run["Run one step with compare-and-set writes,<br/>within 270 s (heavy) or 45 s (light)"]
  Run --> Notify["Notify: COMPLETE → success,<br/>FAILED → failure, waiting for you → attention"]
  Notify --> Due{Wakeup due?}
  Due -->|no| Clear[Clear the token]
  Due -->|yes| Publish[Publish with a new token]
  Publish --> Save[Save the new token]
  Clear --> Release([Release the lease: done])
  Save --> Release
```

## Schedule Token — Publish, Then Save

A delivery runs only with the job's current token. The next wakeup is published first and its
token saved second, so a publish that fails leaves the delivered token valid for QStash's
retry, and a save that fails leaves only a stale message behind.

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

## Steps With Ports — Drive First, Then the Work

The trigger and the transfer adopt a verified backup of the period already in Drive before
any export or download (a forced job adopts only its own). The write-ahead click marker and
each transfer marker are saved before their work starts; a cancel request seen at one of them
stops the step, and the next tick cancels.

```mermaid
flowchart LR
  Created[CREATED] --> Trigger[TRIGGERING_EXPORT]
  Trigger -->|Drive holds the period| Complete([COMPLETE])
  Trigger -->|marker saved, clicked| Waiting[WAITING_FOR_EMAIL<br/>+5 / +15 / +30 m]
  Waiting -->|trusted email this job claims| Found[EMAIL_FOUND]
  Waiting -->|48 h, attempts left| Trigger
  Found -->|Drive holds the period| Complete
  Found -->|download, verify, upload| Complete
  Found -->|invalid ZIP twice, link expired| Trigger
```

At the transition to COMPLETE, the backup is compared with the newest earlier COMPLETE job:
below half its file count or size, `result.shrink` is saved, an `export.shrunk` event is
written, and the success notification becomes a ⚠️. The job completes either way.

## Notifications — `JobNotifications`

```mermaid
flowchart LR
  Event[success · failure ·<br/>attention · login warning] --> Gate{attention: first for this<br/>job and code in 24 h?<br/>lost: first for this service?}
  Gate -->|no| Skip([skipped])
  Gate -->|yes| Fan[CompositeNotifier:<br/>console + Telegram]
  Fan -->|a channel fails| Logged[notify.failed:<br/>name and code only]
  Fan --> Record[Job event in events:jobId,<br/>or health for a login warning]
```

Nothing in this path throws: a failed channel, gate or event write is logged, and the tick
goes on.
