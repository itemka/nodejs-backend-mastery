import { defineConfig } from 'vitest/config';

/**
 * Opt-in Playwright suites against local fixture pages, with your installed Chrome headless;
 * never part of `test` or CI. They never open Notion.
 */
export default defineConfig({
  test: {
    environment: 'node',
    fileParallelism: false,
    include: ['tests/browser/**/*.browser.ts'],
    testTimeout: 60_000,
  },
});
