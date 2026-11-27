/// <reference types="vitest" />
import { copyFileSync, existsSync } from 'node:fs';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { defineConfig, type Plugin } from 'vite';
import react from '@vitejs/plugin-react';

/**
 * GitHub Pages has no server rewrites. The app uses path routes (react-router), so the
 * static build ships `404.html` as a copy of `index.html`: any deep link is served the app,
 * which then routes on `location.pathname` under `BASE_URL`.
 */
function spaFallback(): Plugin {
  let outDir = 'dist';
  return {
    name: 'footballos-spa-404',
    apply: 'build',
    configResolved(config) {
      outDir = resolve(config.root, config.build.outDir);
    },
    closeBundle() {
      const index = resolve(outDir, 'index.html');
      if (existsSync(index)) copyFileSync(index, resolve(outDir, '404.html'));
    },
  };
}

export default defineConfig({
  // The app can be mounted under a path prefix of a larger site (e.g. `/footballos/`); dev and local preview use /.
  base: process.env.VITE_BASE_PATH ?? '/',
  plugins: [react(), spaFallback()],
  resolve: {
    alias: {
      // The contracts workspace package from source (dev, tests and build), as apps/api's
      // vitest config does, so nothing here depends on a built `dist`.
      '@footballos/contracts': fileURLToPath(new URL('../../packages/contracts/src/index.ts', import.meta.url)),
    },
  },
  server: {
    port: 5174,
    proxy: {
      // apps/api (`npm run dev -w apps/api`, port 8787 by default); the app needs it running.
      '/api': { target: process.env.VITE_API_PROXY_TARGET ?? 'http://localhost:8787', changeOrigin: true },
      '/media': { target: process.env.VITE_API_PROXY_TARGET ?? 'http://localhost:8787', changeOrigin: true },
    },
  },
  test: {
    globals: true,
    environment: 'jsdom',
    setupFiles: ['./src/tests/setup.ts', './src/tests/setup.shell.ts'],
    css: false,
    // Screen tests drive whole workflows through the UI; with several test files running in
    // parallel on a busy machine they can take well over Vitest's 5 s default.
    testTimeout: 60000,
  },
});
