import { readFileSync } from 'node:fs';
import path from 'node:path';
import { build } from 'esbuild';

const packageJson = JSON.parse(readFileSync(path.resolve('package.json'), 'utf8'));
const externalNpmDependencies = Object.keys(packageJson.dependencies ?? {}).filter(
  (name) => !name.startsWith('@workspaces/'),
);

await build({
  banner: {
    js: "import { createRequire } from 'node:module';\nconst require = createRequire(import.meta.url);",
  },
  bundle: true,
  entryPoints: ['src/server/main.ts', 'src/cli/main.ts'],
  external: externalNpmDependencies,
  format: 'esm',
  outdir: 'dist',
  outbase: 'src',
  platform: 'node',
  sourcemap: true,
  target: 'node22',
});
