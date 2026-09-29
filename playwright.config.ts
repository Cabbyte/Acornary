import { defineConfig } from '@playwright/test';
import { readFileSync } from 'node:fs';
import { createHash, X509Certificate } from 'node:crypto';
// Trust only the isolated E2E certificate in Chromium's service-worker process.
// Context ignoreHTTPSErrors alone does not cover service-worker script fetches.
const testCertificate = process.env.ACORNARY_E2E_CLOUD
  ? new X509Certificate(readFileSync(`${process.env.ACORNARY_TEST_TLS_DIR ?? '/tls'}/cert.pem`))
  : undefined;
const spki =
  testCertificate &&
  createHash('sha256')
    .update(testCertificate.publicKey.export({ type: 'spki', format: 'der' }))
    .digest('base64');
export default defineConfig({
  testDir: 'tests/browser',
  workers: 1,
  timeout: 30000,
  use: {
    launchOptions:
      spki && process.env.ACORNARY_E2E_BROWSER !== 'webkit'
        ? { args: [`--ignore-certificate-errors-spki-list=${spki}`] }
        : {},
    browserName: process.env.ACORNARY_E2E_BROWSER === 'webkit' ? 'webkit' : 'chromium',
    baseURL: process.env.ACORNARY_E2E_ORIGIN ?? 'http://127.0.0.1:3210',
    ignoreHTTPSErrors: !!process.env.ACORNARY_E2E_CLOUD,
    viewport: { width: 1440, height: 1000 },
    screenshot: 'only-on-failure',
    trace: 'retain-on-failure',
  },
  outputDir: 'output/playwright/results',
  reporter: 'list',
});
