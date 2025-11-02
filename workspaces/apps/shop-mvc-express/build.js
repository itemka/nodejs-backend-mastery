import * as esbuild from 'esbuild';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// Plugin to resolve workspace packages from source
const workspacePlugin = {
  name: 'workspace',
  setup(build) {
    build.onResolve({ filter: /^@workspaces\/packages\/config$/ }, () => {
      return {
        path: path.join(__dirname, '../../packages/config/src/index.ts'),
        external: false,
      };
    });
  },
};

await esbuild.build({
  entryPoints: ['src/server.ts'],
  bundle: true,
  platform: 'node',
  target: 'node22',
  format: 'esm',
  outdir: 'dist',
  packages: 'external', // Keep node_modules external
  plugins: [workspacePlugin],
  sourcemap: false,
  minify: false,
  splitting: false,
  banner: {
    js: `import { createRequire } from 'module';
import { fileURLToPath } from 'url';
import { dirname } from 'path';

const require = createRequire(import.meta.url);
const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
`,
  },
});

console.log('✅ Build completed successfully');

// TODO: review this build script and think about improvements
