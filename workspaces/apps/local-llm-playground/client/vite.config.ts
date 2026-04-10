import tailwindcss from '@tailwindcss/vite';
import react from '@vitejs/plugin-react';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { defineConfig } from 'vite';

const rootDir = fileURLToPath(new URL('.', import.meta.url));

export default defineConfig({
  build: {
    emptyOutDir: true,
    outDir: path.resolve(rootDir, '../dist/client'),
  },
  plugins: [react(), tailwindcss()],
  root: rootDir,
  server: {
    port: 5173,
    proxy: {
      '/api': {
        changeOrigin: true,
        target: process.env.VITE_DEV_API_ORIGIN ?? 'http://localhost:4000',
      },
    },
  },
});
