import { defineConfig } from 'vitest/config';
if (!process.env.ACORNARY_MODEL_TEST_GLOB) throw new Error('Use scripts/test-model-v2.mjs');
export default defineConfig({
  test: {
    include: [process.env.ACORNARY_MODEL_TEST_GLOB],
    fileParallelism: false,
    testTimeout: 30000,
    hookTimeout: 30000,
  },
});
