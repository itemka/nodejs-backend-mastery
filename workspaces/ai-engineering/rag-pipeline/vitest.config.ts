import path from 'node:path';
import { defineConfig } from 'vitest/config';

export default defineConfig({
  resolve: {
    alias: {
      '@workspaces/packages/errors': path.resolve(
        import.meta.dirname,
        '../../packages/errors/src/index.ts',
      ),
    },
  },
  test: {
    // Pilot only (see docs/_todo/testing-quality/unit-testing/README.md): report-only, no
    // threshold. `include` covers all source files (not just imported-and-tested ones) so
    // untouched files are visible in the report instead of silently absent.
    coverage: {
      include: ['src/**/*.ts'],
      provider: 'v8',
      reporter: ['text', 'lcov'],
    },
    environment: 'node',
    include: ['tests/**/*.test.ts'],
  },
});
