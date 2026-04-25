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

For GitHub Copilot, hook adapters are JSON files under `.github/hooks/*.json`. Keep this folder as policy unless a concrete Copilot hook is needed.
