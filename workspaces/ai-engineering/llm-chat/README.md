# LLM Chat

Minimal Node.js/TypeScript LLM chat CLI built on the shared
[`@workspaces/packages/llm-client`](../../packages/llm-client/) package.
The app stays focused on interactive chat behavior while the provider-neutral
LLM types and Anthropic adapter live in the shared package for reuse by other
AI engineering examples.

Assistant responses stream by default in the CLI.

Use `--output-format=json`, `--output-format=csv`, or `--output-format=html`
when you want formatted output on demand. `--structured-commands` is an alias
for `--output-format=json`.

The `json` format uses Anthropic native structured outputs
(`output_config.format`) so it works correctly on Claude 4.6+ without requiring
assistant message prefill. The `csv` and `html` formats use instruction-only
formatting.

## Run

Create `.env` in this folder:

```env
ANTHROPIC_API_KEY="your-api-key-here"
# Optional:
ANTHROPIC_MODEL="claude-sonnet-4-6"
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
- `src/config/env.ts` - app-local `.env` path wrapper around the shared config loader.
- `src/cli/` - argument parsing, readline input adapter, interactive loop.
- `src/chat/` - chat types, message history helpers, chat service that orchestrates a turn.
- `../../packages/llm-client/src/` - provider-neutral types, config loader, provider factory, and Anthropic SDK adapter.
