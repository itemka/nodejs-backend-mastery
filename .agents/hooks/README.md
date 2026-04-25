# Hooks

Hooks are for deterministic automation that should run the same way every time.

## Policy

- Hooks must be safe, predictable, and easy to debug.
- Hooks should not run destructive commands.
- Hooks should not reach external services unless the project explicitly needs it.
- Hooks should be fast enough that developers will not bypass them.
- Tool-specific hook configs belong in tool-specific folders such as `.codex/`, `.claude/`, `.cursor/`, or `.github/`.

## Good Candidates

- Format changed files.
- Run lint for changed packages.
- Run typecheck for changed packages.
- Run the smallest relevant test command.
- Scan for secrets before commit or PR.

Do not add actual hook scripts unless the repo already has a clear convention or the user asks for one.

## Tool-Specific Adapter Notes

- Claude Code: hooks live in `.claude/settings.json`, `.claude/settings.local.json`, user settings, or managed settings. They can also be scoped to a skill or subagent via `hooks:` frontmatter.
- Codex: hooks are configured in Codex config with event tables such as `PreToolUse`, `PostToolUse`, `SessionStart`, `UserPromptSubmit`, and `Stop`; prefer small scripts that read JSON from stdin and return explicit status.
- Cursor: use Cursor project rules or commands for reusable agent behavior. Do not invent hook files unless Cursor documents a tool-native hook surface for the use case.
- GitHub Copilot: check current Copilot docs before adding hook adapters; keep any tool-native files under `.github/`.

Keep this folder as policy. Add tool-native hook files only when a concrete hook is needed.
