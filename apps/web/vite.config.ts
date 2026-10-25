/// <reference types="vitest" />
import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

export default defineConfig({
  // GitHub Pages serves the site under /footballos-prototype/ (the repository name); dev and local preview use /.
  // Hash routing (#/, #/demo, #/research) means no 404 fallback is needed.
  base: process.env.GITHUB_PAGES === 'true' ? '/footballos-prototype/' : '/',
  plugins: [react()],
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
