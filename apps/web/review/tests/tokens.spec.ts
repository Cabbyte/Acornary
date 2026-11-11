import { test, expect } from '@playwright/test';
test('B00 state, isolation, mode and responsive samples', async ({ page }) => {
  const bad: string[] = [];
  const errors: string[] = [];
  page.on('request', (r) => {
    const u = new URL(r.url());
    if (u.origin !== 'http://127.0.0.1:6007' || u.pathname.startsWith('/api')) bad.push(r.url());
  });
  page.on('pageerror', (e) => errors.push(e.message));
  await page.goto('/');
  await expect(page.getByRole('heading', { name: '让每一件物品，清楚可见。' })).toBeVisible();
  for (const width of [320, 360, 390, 768, 1024, 1440, 1920]) {
    await page.setViewportSize({ width, height: 900 });
    for (const mode of ['日常 · 暖陶土', '管理 · 蓝灰']) {
      await page.getByLabel(mode).check();
      for (const section of ['双色与内容面', '文字与密度', '交互状态', '尺度与面板']) {
        await page.getByRole('button', { name: section, exact: true }).click();
        expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(
          true,
        );
      }
    }
  }
  await page.getByRole('button', { name: '交互状态', exact: true }).click();
  await page.getByLabel('物品名称').fill('审阅输入保留');
  await page.getByLabel('日常 · 暖陶土').check();
  await expect(page.getByLabel('物品名称')).toHaveValue('审阅输入保留');
  await page.getByRole('button', { name: '试一下主操作' }).click();
  await expect(page.getByRole('status')).toContainText('没有业务写入');
  await expect(page.getByRole('button', { name: '不可操作', exact: true })).toBeDisabled();
  await page.emulateMedia({ reducedMotion: 'reduce' });
  expect(
    await page
      .locator('main')
      .evaluate((e) => getComputedStyle(e).getPropertyValue('--vn-motion-fast').trim()),
  ).toBe('0ms');
  expect(
    await page.evaluate(async () => (await navigator.serviceWorker.getRegistrations()).length),
  ).toBe(0);
  expect(bad).toEqual([]);
  expect(errors).toEqual([]);
});
