# rag-pipeline — Ingest and Retrieval Flows

Workflow diagrams for [workspaces/ai-engineering/rag-pipeline](../../../workspaces/ai-engineering/rag-pipeline/).
The service is retrieval-only: answer generation happens in
[llm-chat](../../../workspaces/ai-engineering/llm-chat/) through the optional
`search_docs` tool, which calls `POST /search` over HTTP.

Structure-level view: [docs/architecture/workspace.dsl](../../architecture/workspace.dsl).

## Ingest Flow — `POST /ingest`

A markdown document is loaded from the allowed document root (defaults to
`sample-documents/`), chunked with the requested strategy, embedded with
VoyageAI, and written into both in-memory indexes.

```mermaid
flowchart LR
  Client[HTTP client] -->|POST /ingest| Parse[Zod parse<br/>ingestRequestSchema]
  Parse --> Load[loadMarkdownDocument<br/>allowed root only]
  Load --> Strategy{Chunking<br/>strategy}
  Strategy -->|sections| Sections[chunkBySections]
  Strategy -->|characters| Characters[chunkByCharacters<br/>1200 chars, 200 overlap]
  Strategy -->|sentences| Sentences[chunkBySentences<br/>6 sentences, 1 overlap]
  Sections --> Embed[Retriever.ingest<br/>embedDocuments]
  Characters --> Embed
  Sentences --> Embed
  Embed -->|POST /v1/embeddings| Voyage[VoyageAI API]
  Voyage --> Embed
  Embed --> Vector[(In-memory<br/>vector index)]
  Embed --> Bm25[(BM25<br/>lexical index)]
  Vector --> Response[200 JSON<br/>chunkCount + indexSizes]
  Bm25 --> Response
```

## Retrieval Flow — `POST /search`

Hybrid retrieval: the query is embedded and searched against the vector index
(cosine similarity) while the raw text is searched against the BM25 index;
both ranked lists are merged with Reciprocal Rank Fusion (RRF). Each index
queries `max(topK * 2, topK)` candidates before fusion; per-index ranks and
scores are preserved on every fused chunk.

```mermaid
flowchart LR
  Caller[llm-chat search_docs tool<br/>or HTTP client] -->|POST /search| Parse[Zod parse<br/>searchRequestSchema]
  Parse --> Guard{Both indexes<br/>empty?}
  Guard -->|yes| Empty[200 JSON<br/>results: empty + indexEmpty note]
  Guard -->|no| EmbedQ[embedQuery]
  EmbedQ -->|POST /v1/embeddings| Voyage[VoyageAI API]
  Voyage --> Semantic[Vector index search<br/>cosine similarity]
  Parse --> Lexical[BM25 index search<br/>identifier-aware tokens]
  Semantic --> Rrf[Reciprocal Rank Fusion<br/>merge + rank by fused score]
  Lexical --> Rrf
  Rrf --> Response[200 JSON<br/>topK fused chunks with<br/>per-index ranks and scores]
```

Error handling is uniform: thrown errors (Zod validation, path escapes,
embedding failures) reach the Express error handler and return a structured
`{ error: { code, statusCode, ... } }` payload.
