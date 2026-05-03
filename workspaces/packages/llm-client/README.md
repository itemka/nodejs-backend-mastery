# LLM Client

Shared provider-neutral LLM client used by the AI engineering examples.

The package currently wraps the Anthropic SDK behind a small `LlmProvider`
interface so apps can depend on stable request/response types instead of direct
SDK calls.

## Consumers

- [`llm-chat`](../../ai-engineering/llm-chat/) — interactive chat CLI.
- [`prompt-eval-lab`](../../ai-engineering/prompt-eval-lab/) — dataset-driven prompt evaluation CLI.

## Exports

- `createProvider(config)` — returns the default Anthropic-backed provider.
- `createAnthropicClient(apiKey)` and `createAnthropicProvider(client)` — lower-level Anthropic adapter pieces.
- `loadEnvironment(envPath)` and `loadConfig()` — `.env` loading and `ANTHROPIC_API_KEY` / `ANTHROPIC_MODEL` config.
- `LlmProvider`, `LlmRequest`, `LlmResponse`, `Messages`, `OutputFormatConfig`, and related types.

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
