# telegram-webhook-hub — Update Delivery

Workflow diagrams for the [telegram-webhook-hub workspace](../). Codes and limits are in the
[README](../README.md#delivery-guarantees). Structure-level view: the
[repository C4 workspace](../../../../docs/architecture/workspace.dsl).

## Webhook — `handleWebhookRequest`

Telegram retries any non-2xx response ([Bot API](https://core.telegram.org/bots/api#setwebhook)),
so only `200` acknowledges a delivery. Before the handler runs, `serveWebhook` returns `401` for
a missing or wrong secret, `405` for a non-POST, and `503 CONFIG_INCOMPLETE` for invalid
configuration; none of these claims a lease.

The flow below starts with a configured, authenticated POST:

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

Malformed JSON, oversized bodies and invalid updates take the ignored `200` path. A Redis
failure during claim, quota or completion (including an expired lease), or a Telegram or network
failure, returns `503 DELIVERY_UNAVAILABLE` with `Retry-After: 5`. The handler releases a lease
only if this request claimed it; if the release fails, the lease expires after 60 s.
`503 DELIVERY_IN_PROGRESS` leaves the other request's lease intact.

## Button Tap Across Both Apps

What happens when you tap **Retry** on a backup report. Arrows are numbered; notes are work done
inside one endpoint.

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
  Note over B: Mark updateId done
  B-->>H: 200
  Note over H: Complete the receipt
  H-->>T: 200
```

The backup app replies (arrows 4–9) before it answers the hub (arrow 10). So the hub marks the
update done only after the job was retried and you saw the reply.

**If something fails**

- **Temporary failure** (Redis, QStash or the hub unavailable): the backup app answers 503, the
  hub releases its lease and answers 503 instead of arrow 11, and Telegram redelivers the same
  `updateId`.
- **Redelivery:** the backup app finds the receipt it saved before arrow 4, so it sends the saved
  reply again and does not retry the job a second time.
- **Final refusal** (a 4xx other than 408/429 from the backup app): the hub sends a short notice,
  completes the receipt and answers 200; a resend would fail the same way.

Outgoing notifications (backup stored, needs attention) skip the webhook: the backup worker or
cron calls `/api/messages` with `sendMessage`, as in arrows 4–5.
