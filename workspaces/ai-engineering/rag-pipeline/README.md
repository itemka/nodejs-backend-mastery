# rag-pipeline

Minimal Node.js/TypeScript Retrieval-Augmented Generation service. The app
ingests a markdown document, chunks it, embeds chunks with VoyageAI, and serves
hybrid retrieval over an in-memory vector index plus a BM25 lexical index.

The service is retrieval-only: answer generation happens through the
[`llm-chat`](../llm-chat/) app's provider/tool loop using the optional
`search_docs` tool.

## Highlights

- Express HTTP API with `/health`, `/ingest`, and `/search`.
- Three chunking strategies (`sections`, `characters`, `sentences`).
- VoyageAI embeddings (`voyage-3-large` by default; configurable). Uses a
  direct `POST /v1/embeddings` `fetch` call, not the official `voyageai` npm
  SDK, so the package has no fragile vendor-SDK dependency.
- In-memory vector index with cosine similarity and dimension validation.
- BM25 lexical index with identifier-aware tokenization
  (e.g. `INC-2023-Q4-011`).
- Reciprocal Rank Fusion (RRF) merging of semantic and lexical results, with
  per-index ranks and scores preserved on each fused chunk.
- Embeddings live behind an `EmbeddingProvider` interface so tests can use a
  fake provider and avoid live VoyageAI calls.

## Setup

Create `.env` in this folder using `.env.example` as the template:

```env
VOYAGE_API_KEY="your_key_here"
```

Optional overrides (defaults shown):

```env
HOST=127.0.0.1
PORT=4100
NODE_ENV=development
REQUEST_TIMEOUT_MS=120000
VOYAGE_EMBEDDING_MODEL=voyage-3-large
```

`voyage-3-large` is used as the course-aligned default. Newer general-retrieval
models (for example `voyage-4-large`) are valid drop-in values for
`VOYAGE_EMBEDDING_MODEL`. Re-ingest after changing the model: vectors from
different models cannot be compared.

Install dependencies from the repository root:

```bash
pnpm install
```

## Run

```bash
pnpm --filter rag-pipeline dev
```

For a production-style start:

```bash
pnpm --filter rag-pipeline build
pnpm --filter rag-pipeline start
```

## Sample documents

The default sample document path is
[`sample-documents/report.md`](./sample-documents/). The folder is the only
allowed ingest root; relative `sourcePath` values are resolved against it and
absolute or escaping paths are rejected. Add your own report file at
`sample-documents/report.md` for the cross-app demo flow described below.

Tests use small synthetic markdown fixtures under
[`tests/fixtures/`](./tests/fixtures/) so the test suite never depends on a
manually supplied report.

## API

### `GET /health`

Returns `200 OK` with the configured embedding model and current index sizes.

### `POST /ingest`

Loads a markdown document inside the allowed sample directory, chunks it,
embeds chunks via VoyageAI, and adds them to both indexes.

```bash
curl -s -X POST http://127.0.0.1:4100/ingest \
  -H 'content-type: application/json' \
  -d '{"sourcePath":"report.md"}'
```

Optional fields:

- `sourcePath` (default `report.md`) — relative path inside
  `sample-documents/`.
- `strategy` (default `sections`) — `sections`, `characters`, or `sentences`.

### `POST /search`

Embeds the query and runs hybrid retrieval. Returns top-k chunks with the
fused score and per-index ranks/scores when available.

```bash
curl -s -X POST http://127.0.0.1:4100/search \
  -H 'content-type: application/json' \
  -d '{"query":"What happened in INC-2023-Q4-011?","topK":5}'
```

If both indexes are empty (no documents have been ingested yet), the
response also includes `indexEmpty: true` and a human-readable `note`. This
lets callers — including the `llm-chat` `search_docs` tool — tell the
"index is empty" case apart from "your query matched nothing", and forward
the hint to users without guessing implementation details.

`topK` is capped at 20 server-side; the default is 5. Blank or whitespace-only
queries are rejected with `400 VALIDATION_ERROR`.

## Cross-app demo flow

1. Place a report at
   `workspaces/ai-engineering/rag-pipeline/sample-documents/report.md`.
2. In one shell, start the RAG service:

   ```bash
   pnpm --filter rag-pipeline dev
   ```

3. Ingest the sample report (replace the port if you customized it):

   ```bash
   curl -s -X POST http://127.0.0.1:4100/ingest \
     -H 'content-type: application/json' \
     -d '{"sourcePath":"report.md"}'
   ```

4. In another shell, run `llm-chat` with tools and the configured RAG base
   URL:

   ```bash
   pnpm --filter llm-chat dev -- --tools \
     --rag-base-url=http://127.0.0.1:4100 --no-web-search
   ```

5. Ask `What happened in INC-2023-Q4-011?` and verify the model uses retrieved
   source metadata rather than guessing. The CLI shows `[tool] search_docs`
   progress when the tool fires.

`ANTHROPIC_API_KEY` is required for `llm-chat`. The RAG service itself only
needs `VOYAGE_API_KEY`.

## Scope and limits

- In-memory indexes only; data is lost on restart. No external vector database
  in v1.
- Sample document loading is restricted to `sample-documents/` to prevent
  arbitrary file ingestion.
- VoyageAI live calls happen only at runtime; tests use a fake embedding
  provider so the unit suite has no external dependency.
- Answer generation is intentionally out of scope. Use `llm-chat` with
  `search_docs` for the user-facing answer flow.

## Source map

- `src/server.ts` - entrypoint that loads `.env`, constructs the Voyage
  embedding provider, and starts the Express server.
- `src/app.ts` - composes routers, error handling, and the retriever.
- `src/config/env.ts` - Zod-validated environment loader.
- `src/chunking/` - `chunkByCharacters`, `chunkBySentences`, `chunkBySections`.
- `src/documents/load-markdown.ts` - markdown loader with safe-path validation.
- `src/embeddings/` - `EmbeddingProvider` interface and `VoyageEmbeddingProvider`.
- `src/indexes/in-memory-vector-index.ts` - cosine-similarity vector index.
- `src/indexes/bm25-index.ts` - BM25 lexical index with identifier tokens.
- `src/retrieval/` - `Retriever` and `reciprocalRankFusion`.
- `src/routes/` - `/health`, `/ingest`, `/search` routers.
