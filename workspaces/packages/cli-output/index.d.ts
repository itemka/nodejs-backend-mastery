// Type declarations for the shared CLI output theme.
// Hand-written so the package needs no build step (see index.js header).

/** Status symbols for CLI status-line conventions. */
export declare const symbols: {
  readonly success: string;
  readonly failure: string;
  readonly pointer: string;
};

/** Section heading / banner text. */
export declare function heading(text: string): string;

/** Success / OK lines. */
export declare function success(text: string): string;

/** Warnings (recoverable, attention-worthy but not failures). */
export declare function warn(text: string): string;

/** Errors / failures. */
export declare function error(text: string): string;

/** Incidental metadata (ids, paths, counts, raw payload labels). */
export declare function muted(text: string): string;

/** Accent for progress / working / `[tool]` / prompt lines. */
export declare function accent(text: string): string;

/** Dim bracketed prefix tags. */
export declare function prefix(text: string): string;

/** Green OK line prefixed with the success symbol. */
export declare function ok(text: string): string;

/** Red FAIL line prefixed with the failure symbol. */
export declare function fail(text: string): string;
