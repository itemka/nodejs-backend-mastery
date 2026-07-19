import path from 'node:path';
import { defineConfig } from 'vitest/config';

export default defineConfig({
  resolve: {
    alias: {
      '@': path.resolve(import.meta.dirname, 'src'),
      '@workspaces/packages/config': path.resolve(
        import.meta.dirname,
        '../../packages/config/src/index.ts',
      ),
      '@workspaces/packages/errors': path.resolve(
        import.meta.dirname,
        '../../packages/errors/src/index.ts',
      ),
    },
  },
  test: {
    environment: 'node',
    include: ['tests/**/*.test.ts'],
  },
});
