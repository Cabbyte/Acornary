import { defineConfig } from 'vitest/config';
export default defineConfig({
  test: {
    include: ['tests/batch0/postgres.spec.ts'],
    fileParallelism: false,
    testTimeout: 20000,
    hookTimeout: 30000,
  },
});
