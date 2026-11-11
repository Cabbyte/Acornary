import { expect, test, type Page } from '@playwright/test';

async function openWorkbench(page: Page) {
  await page.goto('/');
  // Users can save only after the page is interactive. Reloading while the lazy
  // workbench iframe was still starting reproduced WebKit internal errors and
  // database recreation; keep the reload immediately after the acknowledged save.
  await expect(page.frameLocator('iframe').getByRole('heading').first()).toBeVisible();
}

test('a malformed record arriving after hydration is preserved instead of overwritten', async ({
  page,
}) => {
  await openWorkbench(page);
  const result = await page.evaluate(async () => {
    const modulePath = '/operation-storage-harness.ts';
    const journal = await import(/* @vite-ignore */ modulePath);
    await journal.open();
    await journal.seedMalformedAfterHydration();
    let blocked = false;
    try {
      await journal.save({ replacement: true });
    } catch {
      blocked = true;
    }
    return { blocked, stored: await journal.raw() };
  });
  expect(result.blocked).toBe(true);
  expect(result.stored.value).toEqual({ original: 'must-preserve' });
  expect(result.stored).not.toHaveProperty('stamp');
});

test('browser journal retains the original request after reload and isolates accounts', async ({
  page,
}) => {
  await openWorkbench(page);
  await page.evaluate(async () => {
    const modulePath = '/operation-storage-harness.ts';
    const journal = await import(/* @vite-ignore */ modulePath);
    await journal.open();
    await journal.save({
      state: 'networkUnknown',
      key: 'original-key',
      amount: '1.00',
      revision: 7,
    });
  });
  await page.reload();
  const result = await page.evaluate(async () => {
    const modulePath = '/operation-storage-harness.ts';
    const journal = await import(/* @vite-ignore */ modulePath);
    await journal.open('acceptance-account', 2);
    const restored = journal.load();
    await journal.open('other-account', 3);
    return { restored, other: journal.load() };
  });
  expect(result).toEqual({
    restored: { state: 'networkUnknown', key: 'original-key', amount: '1.00', revision: 7 },
    other: null,
  });
});

test('two browser tabs cannot replace each other’s frozen task', async ({ page, context }) => {
  const other = await context.newPage();
  for (const tab of [page, other]) {
    await openWorkbench(tab);
    await tab.evaluate(async () => {
      const modulePath = '/operation-storage-harness.ts';
      await (await import(/* @vite-ignore */ modulePath)).open();
    });
  }
  await page.evaluate(async () => {
    const modulePath = '/operation-storage-harness.ts';
    await (await import(/* @vite-ignore */ modulePath)).save({ key: 'first-tab', amount: '1' });
  });
  const blocked = await other.evaluate(async () => {
    const modulePath = '/operation-storage-harness.ts';
    const journal = await import(/* @vite-ignore */ modulePath);
    try {
      await journal.save({ key: 'second-tab', amount: '9' });
      return false;
    } catch {
      return true;
    }
  });
  expect(blocked).toBe(true);
  await other.reload();
  const restored = await other.evaluate(async () => {
    const modulePath = '/operation-storage-harness.ts';
    const journal = await import(/* @vite-ignore */ modulePath);
    await journal.open();
    return journal.load();
  });
  expect(restored).toEqual({ key: 'first-tab', amount: '1' });
});
