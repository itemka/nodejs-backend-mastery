// Shared semantic theme for human-facing CLI/terminal output across the repo.
//
// This module is the single source of the color palette. Consumers import the
// named role helpers (not raw colors) so the palette stays consistent and is
// trivial to audit or restyle in one place.
//
// Authored as plain ESM JavaScript with a hand-written `index.d.ts` (no build
// step) so it resolves under both plain `node` (the root `scripts/*.mjs`) and
// the TypeScript toolchain (`tsx`/`vitest`/`tsc`) without a compile step.
//
// Color degradation is delegated entirely to chalk, which honors `NO_COLOR`,
// `FORCE_COLOR`, and TTY detection by default. We never force-enable color, so
// piped/redirected output and CI stay uncolored automatically. Coloring is
// presentational only and must never be embedded into machine-consumed output
// (JSON loggers, protocol streams, persisted values).

import chalk from 'chalk';

/**
 * Status symbols for existing CLI status-line conventions.
 * Kept separate from coloring so callers can use either independently.
 */
export const symbols = {
  success: '✓',
  failure: '✗',
  pointer: '▶',
};

/** Section heading / banner text (e.g. `=== SECTION ===`, `Sources:`). */
export const heading = (text) => chalk.bold.cyan(text);

/** Success / OK lines. */
export const success = (text) => chalk.green(text);

/** Warnings (recoverable, attention-worthy but not failures). */
export const warn = (text) => chalk.yellow(text);

/** Errors / failures. */
export const error = (text) => chalk.red(text);

/** Incidental metadata (ids, paths, counts, raw payload labels). */
export const muted = (text) => chalk.dim(text);

/** Accent for progress / working / `[tool]` / prompt lines. */
export const accent = (text) => chalk.magenta(text);

/** Dim bracketed prefix tags such as `[check-secrets]`. */
export const prefix = (text) => chalk.dim(text);

/** Green OK line prefixed with the success symbol. */
export const ok = (text) => chalk.green(`${symbols.success} ${text}`);

/** Red FAIL line prefixed with the failure symbol. */
export const fail = (text) => chalk.red(`${symbols.failure} ${text}`);
