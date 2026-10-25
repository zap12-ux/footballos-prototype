/// <reference types="vitest" />
import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

// The console server (tools/agent-console) serves ./dist at http://127.0.0.1:4800/ on the
// same origin as /api. In dev, Vite runs on 4801 and proxies /api to the server (or to
// scripts/mock-server.mjs when started via `npm run dev:mock`, which sets CONSOLE_API_ORIGIN).
const apiOrigin = process.env.CONSOLE_API_ORIGIN ?? 'http://127.0.0.1:4800';

export default defineConfig({
  base: '/',
  plugins: [react()],
  server: {
    host: '127.0.0.1',
    port: 4801,
    strictPort: true,
    proxy: {
      '/api': { target: apiOrigin, changeOrigin: false },
    },
  },
  build: { outDir: 'dist', emptyOutDir: true, sourcemap: false },
  test: {
    globals: true,
    environment: 'jsdom',
    setupFiles: './src/tests/setup.ts',
    css: false,
  },
});
