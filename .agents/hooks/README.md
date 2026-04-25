# Hooks

Hooks are for deterministic automation that should run the same way every time.

## Policy

- Hooks must be safe, predictable, and easy to debug.
- Hooks should not run destructive commands.
- Hooks should not reach external services unless the project explicitly needs it.
- Hooks should be fast enough that developers will not bypass them.
- Tool-specific hook configs belong in tool-specific folders such as `.codex/`, `.claude/`, `.cursor/`, or `.github/hooks/`.

## Good Candidates

- Format changed files.
- Run lint for changed packages.
- Run typecheck for changed packages.
- Run the smallest relevant test command.
- Scan for secrets before commit or PR.

Do not add actual hook scripts unless the repo already has a clear convention or the user asks for one.

## Tool-Specific Adapter Notes

- Claude Code: hooks live in `settings.json` / `settings.local.json` and can also be scoped to a single skill or subagent via a `hooks:` frontmatter field. See Claude Code's hooks docs for event names and configuration schema.
- GitHub Copilot: hook adapters are JSON files under `.github/hooks/*.json`.
- Codex and Cursor: check their own docs for current hook/automation hooks; prefer editor/tool-native formats.

Keep this folder as policy. Add tool-native hook files only when a concrete hook is needed.
