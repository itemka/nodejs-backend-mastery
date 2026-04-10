import { build } from 'esbuild';

await build({
  bundle: true,
  entryPoints: ['backend/src/server.ts'],
  format: 'esm',
  outfile: 'dist/backend/server.js',
  packages: 'external',
  platform: 'node',
  sourcemap: true,
  target: 'node22',
});
