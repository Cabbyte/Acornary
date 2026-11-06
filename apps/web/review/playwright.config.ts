import { defineConfig } from '@playwright/test';
export default defineConfig({
  testDir: './tests',
  workers: 1,
  use: { baseURL: 'http://127.0.0.1:6007', screenshot: 'only-on-failure' },
  outputDir: '../../../output/ui-tests',
  webServer: {
    command: 'pnpm dev:ui-preview',
    url: 'http://127.0.0.1:6007',
    reuseExistingServer: !process.env.CI,
    cwd: process.cwd(),
  },
  projects: [
    { name: 'chromium', use: { browserName: 'chromium' } },
    { name: 'webkit', use: { browserName: 'webkit' } },
  ],
});
