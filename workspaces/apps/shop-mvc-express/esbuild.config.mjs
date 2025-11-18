import * as esbuild from 'esbuild';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { rmSync, existsSync, mkdirSync, readdirSync, statSync, copyFileSync } from 'node:fs';

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

    build.onResolve({ filter: /^@workspaces\/packages\/errors$/ }, () => {
      return {
        path: path.join(__dirname, '../../packages/errors/src/index.ts'),
        external: false,
      };
    });
  },
};

// Remove dist directory if it exists
rmSync('dist', { recursive: true, force: true });

await esbuild.build({
  entryPoints: ['src/server.ts'],
  outdir: 'dist',
  packages: 'external', // Keep node_modules external
  plugins: [workspacePlugin],
  platform: 'node',
  target: 'node22',
  format: 'esm', // matches "type": "module"
  bundle: true,
  sourcemap: true,
  logLevel: 'info',
  minify: false,
  splitting: false,
  define: {
    'process.env.NODE_ENV': JSON.stringify('production'),
  },
});

function copyDirectionSync(source, destination) {
  mkdirSync(destination, { recursive: true });

  for (const name of readdirSync(source)) {
    const from = path.join(source, name);
    const to = path.join(destination, name);

    if (statSync(from).isDirectory()) {
      copyDirectionSync(from, to);
    } else {
      copyFileSync(from, to);
    }
  }
}

// Copy static assets if they exist
for (const direction of ['public', 'views']) {
  if (existsSync(direction)) {
    copyDirectionSync(direction, `dist/${direction}`);
  }
}

console.log('✅ Build completed successfully');
