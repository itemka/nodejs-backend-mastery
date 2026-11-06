# Telegram delivery flow

[Configuration, contracts and limits](../README.md) live in the README. These diagrams show
webhook handling and the two-way integration with the backup app.

## Webhook — `handleWebhookRequest`

The entry point checks the Telegram secret and POST method before processing an update.
Missing/wrong secrets return 401, authenticated non-POSTs 405, and invalid configuration 503.
The diagram starts with a configured, authenticated POST.

```mermaid
flowchart TD
  Update([Authenticated POST /api/webhook]) --> Owner{Valid body and private<br/>chat update from the owner?}
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
  Forward -->|5xx, 408, 429, timeout| Retry([Release owned lease: 503])
```

Malformed/oversized bodies and other users' updates are ignored. A busy lease returns 503
`DELIVERY_IN_PROGRESS`. Redis, network or Telegram failures during processing return 503
`DELIVERY_UNAVAILABLE`. Both include `Retry-After: 5`. A failing request releases only its
own lease; if release fails, it expires after 60 s. An integration's permanent refusal is a
4xx other than 408/429. Source: [webhook.ts](../src/http/webhook.ts) and
[Redis state](../src/adapters/redis-state.ts).

## Button Tap Across Both Apps

A Retry tap uses both directions of the integration:

```mermaid
sequenceDiagram
  autonumber
  actor You
  participant T as Telegram
  box telegram-webhook-hub
    participant H as /api/webhook
    participant M as /api/messages
  end
  box notion-backup-automation
    participant B as /api/integrations/telegram
  end
  You->>T: Tap Retry
  T->>H: callback "nb-prod:r:2026-10" + secret header
  Note over H: Owner check, lease, quota,<br/>route by the "nb-prod:" prefix
  H->>B: { updateId, input: { kind: "callback", callbackId,<br/>data: "r:2026-10", messageId } } + bearer
  Note over B: Claim updateId, run backup_retry,<br/>save the reply as a receipt
  B->>M: sendMessage (the result)
  M->>T: sendMessage
  B->>M: removeButtons (the old report)
  M->>T: editMessageReplyMarkup
  B->>M: answerCallbackQuery (stop the spinner)
  M->>T: answerCallbackQuery
  Note over B: Button removal and callback answer<br/>are best effort
  Note over B: Mark updateId done
  B-->>H: 200
  Note over H: Complete the receipt
  H-->>T: 200
```

The hub strips the integration namespace before forwarding, preserving `updateId`. Both apps
keep delivery receipts. Once the backup app saves an action reply receipt, a redelivery replays
that reply instead of repeating the mutation. A lost response or retried reply can show a
message more than once: `/api/messages` has no outgoing deduplication.

Transport/storage/scheduling failures remain retryable; permanent refusals finish with a notice.
Worker and cron notifications use only the outgoing half: backup app → `/api/messages` → Telegram.
