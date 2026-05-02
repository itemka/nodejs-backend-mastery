# LLM Chat

Minimal Node.js/TypeScript LLM chat CLI. Currently ships an Anthropic provider; the structure is provider-neutral so other LLMs, tool use, RAG, evals, or MCP can be added later without a rewrite.

Assistant responses stream by default in the CLI.

Use `--output-format=json`, `--output-format=csv`, or `--output-format=html`
when you want formatted output on demand. `--structured-commands` is an alias
for `--output-format=json`.

The `json` format uses Anthropic native structured outputs (`output_config.format`)
so it works correctly on Claude 4.6+ without requiring assistant message prefill.
The `csv` and `html` formats use instruction-only formatting.

## Run

Create `.env` in this folder:

```env
ANTHROPIC_API_KEY="your-api-key-here"
# Optional:
ANTHROPIC_MODEL="claude-sonnet-4-20250514"
```

Install dependencies from the repository root:

```bash
pnpm install
```

Run the interactive chat app from this folder:

```bash
pnpm dev
```

Or from the repository root:

```bash
pnpm --filter llm-chat dev
```

Formatted output from the repository root:

```bash
pnpm --filter llm-chat dev -- --output-format=json
pnpm --filter llm-chat dev -- --output-format=csv
pnpm --filter llm-chat dev -- --output-format=html
```

The system prompt and temperature are currently hardcoded in `src/main.ts` as `SYSTEM_PROMPT` and `TEMPERATURE`.

## Source Map

- `src/main.ts` - thin CLI bootstrap.
- `src/config/env.ts` - `.env` loading, API key validation, model selection.
- `src/cli/` - argument parsing, readline input adapter, interactive loop.
- `src/chat/` - chat types, message history helpers, chat service that orchestrates a turn.
- `src/llm/` - provider-neutral types and provider factory.
- `src/llm/anthropic/` - Anthropic SDK adapter (client, messages API, response text extraction).
