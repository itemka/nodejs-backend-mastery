# Telegram update delivery

```mermaid
flowchart LR
    Telegram[Telegram] --> Auth[Authenticate webhook and owner chat]
    Auth --> Lease[Claim delivery lease]
    Lease --> Route[Route command or callback namespace]
    Route --> Feature[Authenticated feature receiver]
    Feature --> Done[Complete receipt]
    Feature -->|temporary failure| Retry[Release lease and return 503]
    Retry --> Telegram
    Feature -->|4xx except 408 and 429| Refused[Notify and complete receipt]
    Feature --> Outbound[Authenticated hub messages endpoint]
    Outbound --> Bot[Telegram Bot API]
```

The feature receiver deduplicates domain actions by update ID. A completed hub
receipt prevents repeat forwarding. In-flight duplicates retry after the current
lease; delivery resumes after temporary failures. A permanent refusal (an
integration 4xx other than 408 and 429) is finished with a notice instead of
being redelivered. Both apps retain their own
state and deployment boundaries.
