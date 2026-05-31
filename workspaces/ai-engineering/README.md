# AI Engineering

Small runnable examples for learning the Claude API, MCP, Claude Code workflows, and related AI engineering patterns.

Examples build on top of [`@workspaces/packages/llm-client`](../packages/llm-client/), a small provider-neutral wrapper around the Anthropic SDK.

## Examples

- [llm-chat](./llm-chat/) — interactive LLM chat CLI with multi-turn history, streaming, structured output formats (JSON/CSV/HTML), and optional Claude tool-use mode.
- [mcp-chat](./mcp-chat/) — CLI chatbot paired with an in-memory document MCP server. Mention documents with `@doc_name`, run MCP prompts as `/format doc_id`, and verify tools/resources/prompts through MCP Inspector.
- [prompt-eval-lab](./prompt-eval-lab/) — automated prompt-evaluation pipeline that loads a JSON dataset, calls the model, and grades each response with a model-based grader plus code-based syntax validators.
- [rag-pipeline](./rag-pipeline/) — Express RAG retrieval service with VoyageAI embeddings, an in-memory vector index, a BM25 lexical index, and hybrid RRF retrieval. Consumed by `llm-chat` over HTTP via the optional `search_docs` tool.
- [claude-capabilities-lab](./claude-capabilities-lab/) — terminal lab for manually testing Claude-specific capabilities (extended thinking, image/PDF input, citations, prompt caching, the Files API, and code execution). Live runs need a real `ANTHROPIC_API_KEY`; CI tests use fakes.
