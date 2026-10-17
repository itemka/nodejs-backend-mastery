import { defineConfig } from 'vitest/config';

/** Opt-in suites against real services; never part of `test` or CI. */
export default defineConfig({
  test: {
    environment: 'node',
    include: ['tests/live/**/*.live.ts'],
    testTimeout: 30_000,
  },
});
