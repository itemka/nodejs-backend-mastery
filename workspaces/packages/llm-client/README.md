# LLM Client

Shared provider-neutral LLM client used by the AI engineering examples.

The package currently wraps the Anthropic SDK behind a small `LlmProvider`
interface so apps can depend on stable request/response types instead of direct
SDK calls.

## Consumers

- [`llm-chat`](../../ai-engineering/llm-chat/) — interactive chat CLI.
- [`prompt-eval-lab`](../../ai-engineering/prompt-eval-lab/) — dataset-driven prompt evaluation CLI.
- [`claude-capabilities-lab`](../../ai-engineering/claude-capabilities-lab/) — manual lab for Claude-specific Anthropic capabilities (thinking, images, PDFs, citations, caching, Files API, code execution).

## Exports

- `createProvider(config)` — returns the default Anthropic-backed provider.
- `createAnthropicClient(apiKey)` and `createAnthropicProvider(client)` — lower-level Anthropic adapter pieces.
- `createAnthropicFilesApi(client)` — wrapper for `client.beta.files` (upload, list, retrieveMetadata, delete, download) with the `files-api-2025-04-14` beta header applied by default.
- `withSystemPromptCache`, `addCacheBreakpointOnLastTool`, `addCacheBreakpointOnLastBlock` — prompt-caching helpers that clone inputs without mutating caller-owned objects.
- `extractSources`, `extractDocumentSources`, `extractWebSearchSources` — derive source references from text-block citations.
- `loadEnvironment(envPath)` and `loadConfig()` — `.env` loading and `ANTHROPIC_API_KEY` / `ANTHROPIC_MODEL` config.
- Content block, citation, image/document source, tool definition, thinking config, usage, and cache-control types.

## Anthropic-specific request options

`LlmRequest` supports several Anthropic-specific fields that are passed through
the adapter:

- `thinking` — `{ type: 'enabled', budgetTokens }`, `{ type: 'adaptive', display? }`, or `{ type: 'disabled' }`. The adapter rejects `enabled` thinking combined with `temperature`, assistant prefill, or `budgetTokens < 1024`/`>= maxTokens`.
- `betas` — when provided, the adapter routes through `client.beta.messages` (used for the Files API beta with `container_upload` blocks and code execution).
- `cacheControl` on text, image, document, tool definition, system prompt blocks, and `tool_use`/`tool_result`/`server_tool_use`/`container_upload` content blocks.

## Content blocks

`LlmContentBlock` covers `text`, `image`, `document`, `thinking`,
`redacted_thinking`, `tool_use`, `tool_result`, `server_tool_use`,
`web_search_tool_result`, `code_execution_tool_result`, `container_upload`, and a
fall-through `unknown` variant. Anthropic-specific server tool definitions
include the web search, text editor, and code execution tools.

## Configuration

Each app owns its local `.env` file and passes the path into
`loadEnvironment(envPath)` through a thin app-side wrapper. The shared package
does not guess an env path, because that would resolve incorrectly once the
package is consumed through a workspace symlink.

```env
ANTHROPIC_API_KEY="your-api-key-here"
# Optional:
ANTHROPIC_MODEL="claude-sonnet-4-6"
```

`loadConfig()` throws when `ANTHROPIC_API_KEY` is missing and falls back to the
package default model when `ANTHROPIC_MODEL` is unset.

## Structured Outputs

Set `request.outputFormat.jsonSchema` to use Anthropic JSON structured outputs
through `output_config.format`. The adapter disables assistant prefill, response
suffixes, and stop sequences for JSON-schema requests so the model response can
remain valid JSON.

Callers should still validate parsed JSON against their own schema. Structured
outputs make malformed JSON much less likely, but refusals or max-token stops can
still produce output that does not satisfy the caller's contract.

## Validation

```bash
pnpm --filter @workspaces/packages/llm-client typecheck
pnpm --filter @workspaces/packages/llm-client test
```
