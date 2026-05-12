import { readFileSync } from 'node:fs';
import path from 'node:path';
import { build } from 'esbuild';

const packageJson = JSON.parse(readFileSync(path.resolve('package.json'), 'utf8'));
const externalNpmDependencies = Object.keys(packageJson.dependencies ?? {}).filter(
  (name) => !name.startsWith('@workspaces/'),
);

await build({
  bundle: true,
  entryPoints: ['src/server.ts'],
  external: externalNpmDependencies,
  format: 'esm',
  outfile: 'dist/server.js',
  platform: 'node',
  sourcemap: true,
  target: 'node22',
});
