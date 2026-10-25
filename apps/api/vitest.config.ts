import path from 'node:path';
import { defineConfig } from 'vitest/config';

export default defineConfig({
  resolve: {
    alias: {
      // Resolve the workspace package from source so tests never depend on a built dist.
      '@footballos/contracts': path.resolve(__dirname, '../../packages/contracts/src/index.ts'),
      '@footballos/media': path.resolve(__dirname, '../../packages/media/src/index.ts'),
      '@footballos/ai': path.resolve(__dirname, '../../packages/ai/src/index.ts'),
    },
  },
  test: {
    include: ['src/test/**/*.test.ts'],
    testTimeout: 120_000,
    hookTimeout: 120_000,
  },
});
