# local-llm-playground — Chat, Compare, and llm-checker Flows

Workflow diagrams for [workspaces/apps/local-llm-playground](../../../workspaces/apps/local-llm-playground/).
All routes are mounted under `/api`; the backend talks to Ollama through its
OpenAI-compatible endpoint (`OLLAMA_BASE_URL`, default
`http://localhost:11434/v1`).

Structure-level view: [docs/architecture/workspace.dsl](../../architecture/workspace.dsl).

## Chat — `POST /api/chat`

One endpoint, two modes selected by the `stream` flag. Every request gets an
abort signal that fires on client disconnect or after `REQUEST_TIMEOUT_MS`.

### Streaming (`stream: true`)

The happy path runs top to bottom; the terminal `done`-vs-`error` branch is
the only fork, and the SSE stream is always closed in a `finally` block.

```mermaid
sequenceDiagram
  participant UI as React UI
  participant API as Express API
  participant Ollama

  UI->>API: POST /api/chat { ..., stream: true }
  API->>API: Zod validate + abort signal (disconnect / timeout)
  API-->>UI: event: start { requestId }
  API->>Ollama: POST chat/completions (stream)

  loop each token chunk
    Ollama-->>API: token
    API-->>UI: event: delta { chunk }
  end

  alt completes
    API-->>UI: event: done { responseText, latencyMs }
  else fails at any point
    API-->>UI: event: error { ApiErrorPayload }
  end
  Note over API,UI: SSE stream is always closed (finally)
```

### Non-streaming (`stream: false`)

One `chat/completions` call, one JSON response.

```mermaid
flowchart LR
  UI[React UI] -->|POST /api/chat<br/>stream: false| API[Express API]
  API -->|POST chat/completions| Ollama
  Ollama --> Resp[200 JSON<br/>responseText + usage + latencyMs]
```

## Multi-Model Compare — `POST /api/compare`

Models run **sequentially** against the same prompt; one failing model does
not abort the run (its error is captured per result), but a client
disconnect/timeout abort stops everything.

```mermaid
flowchart LR
  UI[React UI] -->|POST /api/compare<br/>modelIds + prompt| Validate[Zod validate +<br/>request signal]
  Validate --> Loop[For each modelId,<br/>in order]
  Loop --> Chat[ollamaClient.chat<br/>non-streaming]
  Chat -->|success| Ok[result: success<br/>responseText + latencyMs]
  Chat -->|model error| Err[result: error<br/>ApiErrorPayload]
  Chat -->|abort| Abort[rethrow -> request fails]
  Ok --> Next{More<br/>models?}
  Err --> Next
  Next -->|yes| Loop
  Next -->|no| Response[200 JSON<br/>results plus hadErrors flag]
```

## llm-checker — `GET /api/llm-checker/*` Allowlist Gate

The backend never passes user input into a shell. It only spawns the
`llm-checker` CLI with one of four fixed, allowlisted command shapes
(`check`, `installed`, `ollama-plan`, `recommend --category <enum>`), and
caches results for 5 minutes.

```mermaid
flowchart LR
  UI[React UI] -->|GET /api/llm-checker/check| Check[check]
  UI -->|GET /api/llm-checker/installed| Installed[installed]
  UI -->|GET /api/llm-checker/ollama-plan| Plan[ollama-plan]
  UI -->|GET /api/llm-checker/recommend?category=...| Recommend[Zod validate<br/>category enum]
  Check --> Build[fixed allowlisted args only]
  Installed --> Build
  Plan --> Build
  Recommend --> Build
  Build --> Cache{Cached<br/>&lt; 5 min?}
  Cache -->|hit| Response[200 JSON parsed output]
  Cache -->|miss| Spawn[spawn llm-checker CLI<br/>512 KiB output cap]
  Spawn --> Response
```
