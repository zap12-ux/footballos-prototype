import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    include: ['src/test/**/*.test.ts'],
    // ffmpeg work on the synthetic asset takes a while on a laptop.
    testTimeout: 120_000,
    hookTimeout: 180_000,
    globalSetup: ['./src/test/global-setup.ts'],
  },
});
