import { build } from 'esbuild';

await build({
  bundle: true,
  entryPoints: ['src/server.ts'],
  format: 'esm',
  outfile: 'dist/server.js',
  packages: 'external',
  platform: 'node',
  sourcemap: true,
  target: 'node22',
});
