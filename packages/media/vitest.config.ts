import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { defineConfig } from 'vitest/config';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

export default defineConfig({
  resolve: {
    alias: {
      // Resolve the contracts package from source so tests do not depend on its dist build.
      '@footballos/contracts': path.resolve(__dirname, '../../packages/contracts/src/index.ts'),
    },
  },
  test: {
    include: ['src/test/**/*.test.ts'],
    // ffmpeg work on the synthetic asset takes a while on a laptop.
    testTimeout: 120_000,
    hookTimeout: 180_000,
    globalSetup: ['./src/test/global-setup.ts'],
  },
});
