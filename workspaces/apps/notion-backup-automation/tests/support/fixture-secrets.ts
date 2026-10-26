/**
 * Secret-shaped test values, built at run time: as literals in a `token:` or `SECRET =` line they
 * trip secret scanners (Gitleaks `generic-api-key`). No service ever issued them.
 */
const HEX_DIGITS = Array.from({ length: 16 }, (_, digit) => digit.toString(16)).join('');

/** A wakeup token, `tok_` and 16 hex digits. */
export const TEST_TOKEN = `tok_${HEX_DIGITS}`;

/** The daily cron's bearer secret. */
export const TEST_CRON_SECRET = `cron-secret-${HEX_DIGITS}${HEX_DIGITS}`;
