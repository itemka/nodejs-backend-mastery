# Local LLM Playground

Local-only LLM lab for macOS Apple Silicon using Ollama on the same machine. The app is split into a small Express API, a Vite + React UI, and shared TypeScript modules so you can inspect how local LLM integration works end to end.

## Features

- Express API that talks to Ollama through the OpenAI-compatible endpoint at `http://localhost:11434/v1`
- Normal and streaming chat modes
- Configured multi-model compare flow
- `llm-checker` integration through a strict backend allowlist
- Minimal React UI with localStorage persistence
- Shared schemas and types for frontend/backend consistency
- Focused tests for validation and stream parsing

## Folder tree

```text
workspaces/apps/local-llm-playground/
  .env.example
  backend/
    esbuild.config.mjs
    src/
      app.ts
      server.ts
      routes/
      services/
      middleware/
      lib/
  client/
    index.html
    vite.config.ts
    src/
      App.tsx
      components/
      hooks/
      lib/
  shared/
    api.ts
    models.ts
  package.json
  README.md
  vitest.config.ts
```

## Supported models

- `qwen2.5:7b`
- `yi:6b`
- `llama3.1:8b`
- `deepseek-coder-v2:16b`

## Environment

Copy `.env.example` to `.env`:

```bash
PORT=4000
OLLAMA_BASE_URL=http://localhost:11434/v1
OLLAMA_RAW_BASE_URL=http://localhost:11434
OLLAMA_API_KEY=ollama
DEFAULT_MODEL=qwen2.5:7b
REQUEST_TIMEOUT_MS=120000
```

## Setup

1. Make sure Ollama is installed and running locally
2. Pull at least one supported model, for example:

```bash
ollama pull qwen2.5:7b
```

3. Create the local env file:

```bash
cp workspaces/apps/local-llm-playground/.env.example workspaces/apps/local-llm-playground/.env
```

4. Install workspace dependencies from the repo root:

```bash
pnpm install
```

## Run

Development mode starts the Express API and Vite client together:

```bash
pnpm --filter local-llm-playground dev
```

The `dev` script runs the API and the Vite dev server in parallel. The `client:dev` step polls `GET /api/health` on the dev API origin (see `VITE_DEV_API_ORIGIN` in `.env.example`) until the backend responds or a timeout elapses, then starts Vite so the UI does not load against a cold API. If you need Vite immediately without that wait (for example when debugging the client against a remote API), use `pnpm --filter local-llm-playground client:dev:vite` instead.

Open:

- Vite client: `http://localhost:5173`
- API health: `http://localhost:4000/api/health`

Production-like local run:

```bash
pnpm --filter local-llm-playground build
pnpm --filter local-llm-playground start
```

After `build` + `start`, the backend serves the built client from `http://localhost:4000`.

## Scripts

- `pnpm --filter local-llm-playground dev` — API + Vite; client waits for API health before starting Vite when `VITE_API_BASE_URL` is unset
- `pnpm --filter local-llm-playground client:dev:vite` — Vite only, no API readiness wait (use from the `local-llm-playground` package directory or via pnpm as above)
- `pnpm --filter local-llm-playground build`
- `pnpm --filter local-llm-playground start`
- `pnpm --filter local-llm-playground typecheck`
- `pnpm --filter local-llm-playground lint`
- `pnpm --filter local-llm-playground test`

## API

- `GET /api/health`
- `GET /api/models`
- `POST /api/chat`
- `POST /api/compare`
- `GET /api/llm-checker/check`
- `GET /api/llm-checker/recommend?category=reasoning|coding|general`
- `GET /api/llm-checker/installed`
- `GET /api/llm-checker/ollama-plan`

## UI overview

- Chat panel with model selector, presets, stream toggle, temperature, max tokens, copy, and cancel
- Compare panel that runs the same prompt against 2-4 configured models
- LLM Checker panel with manual refresh per section and a sequential `Load all`

## Manual test checklist

- Start Ollama locally and confirm `GET /api/health` reports `ollamaAvailable: true`
- Open the UI and verify the configured models list shows installed status
- Send a non-streaming chat request with `qwen2.5:7b`
- Send a streaming chat request and confirm text appears incrementally
- Cancel an in-flight chat request
- Compare at least two installed models and confirm per-model latency/results render
- Load `LLM Checker` sections and confirm output appears for check, installed, reasoning, coding, and ollama plan
- Run `pnpm --filter local-llm-playground test`
- Run `pnpm --filter local-llm-playground typecheck`
- Run `pnpm --filter local-llm-playground lint`

## MVP vs next

### MVP included

- Local-only Ollama integration
- Chat, compare, and streaming flows
- `llm-checker` backend wrapper
- Small React UI with persistence and cancellation
- Tests for validation/model helpers/stream parsing

### Good next improvements

- Better structured rendering for `llm-checker` text output
- Side-by-side diff view for compare results
- Prompt history saved locally
- Request logs panel in the UI
