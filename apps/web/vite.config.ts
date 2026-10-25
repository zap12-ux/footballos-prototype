/// <reference types="vitest" />
import { copyFileSync, existsSync } from 'node:fs';
import { resolve } from 'node:path';
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
  // GitHub Pages serves the site under /footballos-prototype/ (the repository name); dev and local preview use /.
  base: process.env.GITHUB_PAGES === 'true' ? '/footballos-prototype/' : '/',
  plugins: [react(), spaFallback()],
  server: {
    port: 5174,
    proxy: {
      // Backend's API (may not be running; the app works in VITE_API_MODE=mock without it).
      '/api': { target: process.env.VITE_API_PROXY_TARGET ?? 'http://localhost:8789', changeOrigin: true },
      '/media': { target: process.env.VITE_API_PROXY_TARGET ?? 'http://localhost:8789', changeOrigin: true },
    },
  },
  test: {
    globals: true,
    environment: 'jsdom',
    setupFiles: './src/tests/setup.ts',
    css: false,
    // Full-workflow integration tests drive six plays through the UI; with four test files
    // running in parallel on a busy machine they can take well over Vitest's 5 s default.
    testTimeout: 60000,
  },
});
