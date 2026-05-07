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

Use `--tools` to enable local Claude tool-use turns. Tool mode is explicit
because it can make extra model calls. For v1, tool mode cannot be combined
with `--output-format=*` or `--structured-commands`.

Anthropic Web Search is enabled by default for normal chat and `--tools` mode.
Claude decides when to issue searches; the app does not execute them locally.
Use `--no-web-search` to disable. Web Search is automatically disabled with
`--output-format=*`, `--structured-commands`, and the
`--tools --fine-grained-tool-streaming` combination — see
[Anthropic Web Search Tool](#anthropic-web-search-tool) below.

Use `--fine-grained-tool-streaming` together with `--tools` to enable
Anthropic fine-grained tool streaming. When active, the provider streams
partial tool input JSON incrementally using `eager_input_streaming: true` on
each user-defined tool. The app accumulates chunks and only executes the tool
once the full input JSON is parsed after the `content_block_stop` event.
Progress is reported through the normal `[tool]` output lines:
`Streaming input for <tool>` and `Tool input completed`. If the streamed JSON
is malformed (for example, cut off by `max_tokens`), the tool receives an
error result and is not executed.

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

Tool-use mode from the repository root:

```bash
pnpm --filter llm-chat dev -- --tools
```

Fine-grained tool streaming mode:

```bash
pnpm --filter llm-chat dev -- --tools --fine-grained-tool-streaming
```

Anthropic Text Editor Tool mode (file editing is opt-in):

```bash
pnpm --filter llm-chat dev -- --tools --edit-files --workspace-root=.
```

Optional max characters for `view`:

```bash
pnpm --filter llm-chat dev -- --tools --edit-files --text-editor-max-characters=10000
```

Example prompts:

- `What is the exact current time?`
- `What date and time is 103 days from now?`
- `Set a reminder for my dentist appointment tomorrow at 09:00.`

When Claude requests a tool, the app appends the assistant `tool_use` message,
runs the matching local tool in Node.js, appends a user message with matching
`tool_result` blocks, and sends the updated history back to Claude. The loop
continues until Claude returns a normal final response.

Available v1 tools:

- `get_current_datetime` - reads the app's current process clock.
- `add_duration_to_datetime` - adds or subtracts seconds, minutes, hours, days,
  weeks, months, or years from an ISO datetime.
- `set_reminder` - stores a mock reminder in process memory only. It does not
  persist reminders or schedule real notifications.

Tool progress lines use the `[tool]` prefix. `--debug-response` still prints raw
provider responses and should be treated as developer-only output, especially
with sensitive prompts.

## Anthropic Text Editor Tool

`--edit-files` enables Anthropic's
[`text_editor_20250728`](https://platform.claude.com/docs/en/agents-and-tools/tool-use/text-editor-tool)
client tool, named `str_replace_based_edit_tool`. The tool definition is
schema-less — Claude knows the schema internally — and the application owns
all file-system execution. The tool is rejected unless `--tools` is also set.

The runtime supports four commands:

- `view` - reads a file with line-numbered output, optional `view_range`, and
  optional `max_characters` truncation, or lists a directory non-recursively.
- `create` - writes a new file under the allowed workspace root. Refuses to
  overwrite an existing file.
- `str_replace` - replaces exactly one occurrence of `old_str`. Errors when
  `old_str` matches zero or more than one time.
- `insert` - inserts `insert_text` after `insert_line` (1-indexed; `0` inserts
  at the beginning of the file).

`undo_edit` is intentionally not supported. Restore from
`.llm-chat-edit-backups/<relative-path>` if needed. Backups are written before
every `str_replace` and `insert`.

### Security model

- `--workspace-root=<path>` (default: `process.cwd()`) bounds every file
  operation. Paths are normalized against the root and rejected when they
  escape via `..`, absolute paths, or symbolic links.
- Hidden paths (segments starting with `.`) are blocked by default. `.env` and
  `.env.*` files stay blocked even when hidden paths are otherwise allowed.
- `node_modules`, `.git`, and the backup directory are blocked.
- Binary and non-UTF-8 files are rejected.
- `view` enforces a max readable byte size; write operations enforce a max
  editable byte size and return a clear `tool_result` error when exceeded.
- Errors are returned as `tool_result` blocks with `is_error: true` and
  sanitized messages. Stack traces, raw old/new strings, and absolute paths
  outside the workspace root are not echoed back to Claude.

### Limitations

- v1 does not support `undo_edit`, deletes, renames, chmod, or shell
  execution.
- v1 rejects `--fine-grained-tool-streaming` together with `--edit-files`
  because per-tool `eager_input_streaming` is documented as user-defined-tool
  only.
- v1 does not include per-operation user confirmation. The `--edit-files`
  flag is the explicit opt-in for the entire session.

## Anthropic Web Search Tool

Anthropic's
[`web_search_20250305`](https://docs.claude.com/en/docs/agents-and-tools/tool-use/web-search-tool)
server tool is included by default on every Anthropic chat request. The model
decides when to search; the application does not execute searches locally and
does not return `tool_result` blocks for `server_tool_use`. Search calls are
billed per [Anthropic pricing](https://docs.claude.com/en/docs/agents-and-tools/tool-use/web-search-tool#pricing)
and require Web Search to be enabled for the organization in the Anthropic
Console.

Default behavior:

- `max_uses: 5` per API request limits how many searches Claude may issue.
- The terminal renders a compact `Sources:` block after the answer with up to
  5 deduped entries (by URL). Source rendering does not change billing or
  what is sent to Claude — it is a display cap only.
- Encrypted search content, encrypted citation indexes, and raw provider JSON
  are kept out of the answer text.

Disable Web Search:

```bash
pnpm --filter llm-chat dev -- --no-web-search
```

Web Search is automatically disabled in v1 for:

- `--output-format=json|csv|html` and `--structured-commands` — citations and
  strict structured output are a poor fit and may produce malformed responses.
- `--tools --fine-grained-tool-streaming` — the fine-grained streaming
  accumulator does not yet preserve server-tool blocks. Use plain `--tools`
  if you want both client tools and Web Search at the same time.

Domain restrictions (`allowedDomains`, `blockedDomains`) and `userLocation`
are modeled in the shared `LlmAnthropicWebSearchToolDefinition` type but are
not yet exposed via CLI flags.

The system prompt and temperature are currently hardcoded in `src/main.ts` as `SYSTEM_PROMPT` and `TEMPERATURE`.

## Source Map

- `src/main.ts` - thin CLI bootstrap.
- `src/config/env.ts` - app-local `.env` path wrapper around the shared config loader.
- `src/cli/` - argument parsing, readline input adapter, interactive loop.
- `src/chat/` - chat types, message history helpers, chat service that orchestrates a turn.
- `src/tools/` - app-local tool registry, runner, mock tool implementations, and the
  Anthropic Text Editor runtime under `src/tools/text-editor/`.
- `../../packages/llm-client/src/` - provider-neutral types, config loader, provider factory, and Anthropic SDK adapter.
