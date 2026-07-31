import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    globalSetup: './vitest.global-setup.ts',
    setupFiles: './vitest.setup.ts',
    // API integration tests share one SQLite database and must not delete each other's fixtures.
    fileParallelism: false,
    testTimeout: 30_000,
  },
});
