import tailwindcss from '@tailwindcss/vite';
import react from '@vitejs/plugin-react';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { defineConfig, type ServerOptions } from 'vite';

const rootDir = fileURLToPath(new URL('.', import.meta.url));
const host = process.env.HOST ?? '127.0.0.1';
const httpsCertPath = process.env.HTTPS_CERT_PATH ?? '.certs/localhost.pem';
const httpsKeyPath = process.env.HTTPS_KEY_PATH ?? '.certs/localhost-key.pem';
const workspaceDir = process.cwd();

export default defineConfig(({ command }) => ({
  build: {
    emptyOutDir: true,
    outDir: path.resolve(rootDir, '../dist/client'),
  },
  plugins: [react(), tailwindcss()],
  root: rootDir,
  ...(command === 'serve' ? { server: createDevServerOptions() } : {}),
}));

function loadLocalHttpsServerOptions(): NonNullable<ServerOptions['https']> {
  return {
    cert: readFileSync(path.resolve(workspaceDir, httpsCertPath)),
    key: readFileSync(path.resolve(workspaceDir, httpsKeyPath)),
  };
}

function createDevServerOptions(): ServerOptions {
  return {
    host,
    https: loadLocalHttpsServerOptions(),
    port: 5173,
    proxy: {
      '/api': {
        changeOrigin: true,
        secure: false,
        target: process.env.VITE_DEV_API_ORIGIN ?? 'https://127.0.0.1:4000',
      },
    },
  };
}
