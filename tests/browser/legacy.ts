import { test as base, expect } from '@playwright/test';

/** Existing suites deliberately verify the supported legacy selector contract. */
export const test = base.extend({
  context: async ({ context }, use) => {
    await context.addInitScript(() => {
      try {
        sessionStorage.setItem('acornary-ui', 'legacy');
      } catch {
        /* Sandboxed plugin. */
      }
    });
    await use(context);
  },
});
export { expect };
export type { Page, BrowserContext, FrameLocator } from '@playwright/test';
