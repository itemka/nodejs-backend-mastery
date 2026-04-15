import tailwindcss from '@tailwindcss/vite';
import react from '@vitejs/plugin-react';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { defineConfig, loadEnv, type ServerOptions } from 'vite';

const rootDir = fileURLToPath(new URL('.', import.meta.url));
const workspaceDir = path.resolve(rootDir, '..');

export default defineConfig(({ command, mode }) => {
  const env = loadEnv(mode, workspaceDir, '');

  return {
    build: {
      emptyOutDir: true,
      outDir: path.resolve(rootDir, '../dist/client'),
    },
    plugins: [react(), tailwindcss()],
    root: rootDir,
    ...(command === 'serve' ? { server: createDevServerOptions(env) } : {}),
  };
});

function loadLocalHttpsServerOptions(
  env: Record<string, string>,
): NonNullable<ServerOptions['https']> {
  const httpsCertPath = env.HTTPS_CERT_PATH ?? '.certs/localhost.pem';
  const httpsKeyPath = env.HTTPS_KEY_PATH ?? '.certs/localhost-key.pem';

  return {
    cert: readFileSync(path.resolve(workspaceDir, httpsCertPath)),
    key: readFileSync(path.resolve(workspaceDir, httpsKeyPath)),
  };
}

function createDevServerOptions(env: Record<string, string>): ServerOptions {
  const host = env.HOST ?? '127.0.0.1';

  return {
    host,
    https: loadLocalHttpsServerOptions(env),
    port: 5173,
    proxy: {
      '/api': {
        changeOrigin: true,
        secure: false,
        target: resolveDevApiOrigin(env),
      },
    },
  };
}

function resolveDevApiOrigin(env: Record<string, string>): string {
  const configuredDevApiOrigin = normalizeOptionalEnvironmentValue(env.VITE_DEV_API_ORIGIN);

  if (configuredDevApiOrigin) {
    return configuredDevApiOrigin;
  }

  const host = normalizeOptionalEnvironmentValue(env.HOST) ?? '127.0.0.1';
  const port = normalizeOptionalEnvironmentValue(env.PORT) ?? '4000';

  return `https://${formatHostForUrl(host)}:${port}`;
}

function formatHostForUrl(host: string): string {
  const normalizedHost = host.replaceAll(/^\[|\]$/g, '');

  return normalizedHost.includes(':') ? `[${normalizedHost}]` : normalizedHost;
}

function normalizeOptionalEnvironmentValue(value: string | undefined): string | undefined {
  const normalizedValue = value?.trim();

  return normalizedValue === '' ? undefined : normalizedValue;
}
