---
paths:
  - '.github/workflows/**'
---

# Claude Code In CI

Repository CI conventions live in [repo-map.md](../../.agents/rules/repo-map.md) § _Config And CI_.
This rule covers only how Claude Code itself behaves when a workflow drives it.

- Headless runs use `-p` / `--print`. It selects output mode and nothing else; project
  configuration still loads. [Bare mode](https://code.claude.com/docs/en/headless#start-faster-with-bare-mode)
  skips skill and `CLAUDE.md` discovery, auto memory, and settings/plugin hooks. Pass servers,
  settings, and subagents explicitly (`--mcp-config`, `--settings`, `--agents`); use `--add-dir .`
  to load repo skills by `/name`, or omit `--bare`. Anthropic API auth requires `ANTHROPIC_API_KEY`
  or an `apiKeyHelper` in bare mode, never OAuth.
- `--output-format` takes `text`, `json`, or `stream-json`. Pair `json` with `--json-schema`
  (print mode only) when a later step parses the result, and read the schema-conforming data from
  the response envelope rather than the top level.
- `--system-prompt` / `--system-prompt-file` replace the default system prompt;
  `--append-system-prompt` / `--append-system-prompt-file` add to it. Prefer appending, which
  keeps the built-in tool guidance.
- Gate tools explicitly: `--allowed-tools` pre-approves without prompting, `--disallowed-tools`
  denies, `--permission-mode` sets the starting mode, `--max-turns` bounds an agentic run.
- Run review as its own invocation. A session that produced a change carries the reasoning that
  justified it and will not challenge it; a second, independent run will.
- Pass prior findings into a re-review so it reports new issues and still-present ones, instead
  of re-raising findings a human already saw and declined.
- Secrets reach the action through repository secrets and `with:` / `env:`. Never inline a token
  in workflow YAML or in a prompt.
