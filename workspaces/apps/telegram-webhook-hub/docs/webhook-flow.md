# telegram-webhook-hub — Update Delivery

Workflow diagrams for the [telegram-webhook-hub workspace](../). Codes and limits are in the
[README](../README.md#delivery-guarantees). Structure-level view: the
[repository C4 workspace](../../../../docs/architecture/workspace.dsl).

## Webhook — `handleWebhookRequest`

Every answer except `503` tells Telegram the update is finished. A `503` releases this
request's lease, so Telegram's redelivery can claim it again.

```mermaid
flowchart TD
  Update([Telegram POST /api/webhook]) --> Secret{Secret header<br/>matches?}
  Secret -->|no| Unauth([401])
  Secret -->|yes| Owner{Private chat update<br/>from the owner?}
  Owner -->|no| Ignore([200: ignored])
  Owner -->|yes| Claim{Claim the<br/>update's lease}
  Claim -->|already done| Dup([200: duplicate])
  Claim -->|in progress| Busy([503: retry later])
  Claim -->|claimed| Quota{Within 30<br/>updates/hour?}
  Quota -->|no| Limited([Notice on a tap, complete: 200])
  Quota -->|yes| Route{Command owner or<br/>callback namespace?}
  Route -->|none| Help([Help text or 'unknown integration',<br/>complete: 200])
  Route -->|integration| Forward[POST to the integration<br/>with its bearer token, 20 s]
  Forward -->|2xx| Done([Complete: 200])
  Forward -->|4xx except 408, 429| Refused([Notice, complete: 200])
  Forward -->|5xx, 408, 429, timeout| Retry([Release the lease: 503])
```

## Button Tap Across Both Apps

A tap on a backup report's Retry button. The backup app replies through the hub's messages
endpoint before it answers the forwarded request, so the hub completes its receipt only after
the action and the reply are done.

```mermaid
sequenceDiagram
  participant T as Telegram
  participant H as Hub /api/webhook
  participant B as Backup /api/integrations/telegram
  participant M as Hub /api/messages
  T->>H: callback "nb-prod:r:2026-10" + secret header
  H->>H: owner check, lease, quota, route by namespace
  H->>B: { updateId, input: { data: "r:2026-10" } } + bearer
  B->>B: claim updateId, backup_retry, save a reply receipt
  B->>M: sendMessage, removeButtons, answerCallbackQuery + bearer
  M->>T: Bot API calls to the owner chat
  B-->>H: 200
  H->>H: complete the receipt
  H-->>T: 200
```

If the backup app answers 503 (Redis, QStash or the hub unavailable), the hub releases its
lease and returns 503, and Telegram redelivers the same `updateId`. The backup app's own
receipt makes the redelivery replay the saved reply instead of retrying the job twice.
Outgoing notifications (backup stored, needs attention) use only the last two participants:
the backup worker or cron calls `/api/messages` directly.
