# @workspaces/cli-output

Single shared color theme for **human-facing** terminal output across the repo.
Consumers import named semantic roles (not raw colors) so the palette stays
consistent and is easy to audit or restyle in one place.

It wraps [`chalk@^5`](https://github.com/chalk/chalk) and relies entirely on
chalk's `NO_COLOR` / `FORCE_COLOR` / TTY detection — color degrades to plain
text automatically when piped, redirected, in CI, or when `NO_COLOR` is set. It
is **never** for machine-consumed output (JSON loggers, MCP/protocol streams, or
any value that gets persisted or returned in a response).

Authored as plain ESM JavaScript with a hand-written `index.d.ts` (no build
step) so it resolves under both plain `node` (the repo's `scripts/*.mjs`) and
the TypeScript toolchain (`tsx` / `vitest` / `tsc`).

## Usage

```ts
import * as ui from '@workspaces/cli-output';

console.log(ui.heading('=== Section ==='));
console.log(ui.success('done'));
console.error(
  `${ui.prefix('[check:secrets]')} ${ui.fail('credential detected')}`,
);
```

### Roles

| Helper          | Style       | Use for                                        |
| --------------- | ----------- | ---------------------------------------------- |
| `heading(text)` | bold cyan   | banners (`=== … ===`), `Usage:`, `Sources:`    |
| `success(text)` | green       | success / completion lines                     |
| `warn(text)`    | yellow      | recoverable warnings                           |
| `error(text)`   | red         | failures and error labels                      |
| `muted(text)`   | dim         | ids, paths, counts, raw-payload labels         |
| `accent(text)`  | magenta     | progress / `[tool]` / "Running…" lines         |
| `prefix(text)`  | dim         | bracket tags like `[check:secrets]`            |
| `ok(text)`      | green `✓ …` | script OK status lines                         |
| `fail(text)`    | red `✗ …`   | script FAIL status lines                       |
| `symbols`       | —           | `{ success: '✓', failure: '✗', pointer: '▶' }` |

> Note: nesting one color helper inside another (e.g. `success(accent(x))`)
> breaks the outer color, because the inner reset (`[39m`) clears the
> foreground. `muted` (dim) is safe to nest since its reset (`[22m`) only clears
> intensity. Prefer concatenating separately-colored segments over nesting
> colors.

## Theme demo

See every role rendered in your terminal:

```bash
pnpm --filter @workspaces/cli-output demo
```

It honors chalk's detection, so:

- in a terminal you see colors,
- piped (`… | cat`) or with `NO_COLOR=1` you see plain text,
- `FORCE_COLOR=1 pnpm --filter @workspaces/cli-output demo` forces colors even
  when piped.

## Test

```bash
pnpm --filter @workspaces/cli-output test
```
