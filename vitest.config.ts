import { defineConfig } from 'vitest/config';
export default defineConfig({
  test: {
    include: [
      'tests/*.test.ts',
      'tests/web/**/*.test.ts',
      'tests/batch*/**/*.test.ts',
      'apps/web/src/app-vnext/**/*.test.ts',
    ],
    fileParallelism: false,
    testTimeout: 30000,
    hookTimeout: 30000,
  },
});
