import { test, expect } from '@playwright/test';
import { login } from './login.js';
import { choose } from './controls.js';

test('Impeccable mobile facts, searchable intake and visible review preserve draft without writes', async ({
  page,
}) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto('/items');
  await login(page);
  await expect(page.getByRole('heading', { name: '我的物品', level: 1 })).toBeVisible();
  expect((await page.locator('.ac-mobile-item').first().boundingBox())!.y).toBeLessThan(350);
  await page.getByRole('searchbox', { name: '搜索物品、规格、位置…' }).fill('验收牛奶 1L');
  const rows = page.locator('.ac-mobile-item').filter({ hasText: '验收牛奶 1L' });
  await expect(rows).toHaveCount(6);
  await expect(rows.filter({ hasText: '已开封' })).toContainText('800 mL');
  await expect(rows.filter({ hasText: '开封未记录' })).toHaveCount(5);
  const ids = await rows.locator('.wb-instance-id').allTextContents();
  expect(new Set(ids).size).toBe(6);
  await expect(page.getByRole('combobox', { name: '排序' })).toHaveCount(0);
  await page.getByRole('button', { name: '筛选', exact: true }).click();
  await choose(page, '排序', '最近入库');
  await page.getByRole('button', { name: '筛选', exact: true }).click();
  await page.getByRole('button', { name: '添加物品', exact: true }).click();
  const drawer = page.getByRole('dialog', { name: '入库', exact: true });
  const search = drawer.getByRole('combobox', { name: '选择商品', exact: true });
  for (const query of ['验收牛奶', '示例', 'test-milk-1l']) {
    await search.fill(query);
    await expect(page.getByRole('option').filter({ hasText: '验收牛奶 1L' })).toBeVisible();
  }
  await page.getByRole('option').filter({ hasText: '验收牛奶 1L' }).click();
  await drawer.getByLabel('入库件数', { exact: true }).fill('2');
  await choose(page, '开封状态', '已开封');
  await drawer.getByLabel('到期日期', { exact: true }).fill('2026-12-31');
  await drawer.getByLabel('到期日期', { exact: true }).press('Enter');
  await drawer.getByLabel('每件剩余量', { exact: true }).fill('800');
  let writes = 0;
  page.on('request', (r) => {
    if (r.method() === 'POST' && r.url().includes('/api/write/')) writes++;
  });
  await drawer.getByRole('button', { name: '核对入库信息', exact: true }).click();
  const review = drawer.getByRole('region', { name: '核对本次入库' });
  await expect(review).toBeFocused();
  for (const text of ['验收牛奶 1L', '2 件', '已开封', '2026-12-31', '800 mL'])
    await expect(review).toContainText(text);
  const bounds = (await review.boundingBox())!;
  expect(bounds.y).toBeGreaterThan(0);
  expect(bounds.y + bounds.height).toBeLessThan(780);
  await expect(drawer.getByRole('button', { name: '确认入库', exact: true })).toBeInViewport();
  expect(writes).toBe(0);
  await drawer.getByRole('button', { name: '返回修改' }).click();
  await expect(drawer.getByLabel('入库件数', { exact: true })).toHaveValue('2');
  await expect(drawer.getByLabel('每件剩余量', { exact: true })).toHaveValue('800');
  for (const width of [360, 390, 768, 1440]) {
    await page.setViewportSize({ width, height: 844 });
    await expect(drawer.getByLabel('入库件数', { exact: true })).toHaveValue('2');
    await expect
      .poll(() => page.evaluate(() => document.documentElement.scrollWidth <= innerWidth))
      .toBe(true);
  }
  await page.setViewportSize({ width: 360, height: 844 });
  const close = (await drawer.locator('.ant-drawer-close').boundingBox())!;
  expect(close.width).toBeGreaterThanOrEqual(44);
  expect(close.height).toBeGreaterThanOrEqual(44);
});

test('Impeccable MCP initial and partial host bounds constrain navigation and drawers', async ({
  page,
}) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto('http://127.0.0.1:3212');
  const view = page.frameLocator('#inventory');
  await expect(view.getByRole('heading', { name: '我的物品' })).toBeVisible();
  await page.evaluate(async () => {
    const host = (window as any).host;
    host.layoutContext = {
      safeAreaInsets: { top: 48, right: 12, bottom: 120, left: 12 },
      containerDimensions: { maxHeight: 600 },
    };
    await host.mount();
  });
  await expect(view.getByRole('heading', { name: '我的物品' })).toBeVisible();
  const geometry = () =>
    view.locator('.wb-bottom-nav').evaluate((nav) => {
      const rect = nav.getBoundingClientRect();
      return {
        bottom: rect.bottom,
        left: rect.left,
        header: document.querySelector('.wb-header')!.getBoundingClientRect().top,
      };
    });
  await expect.poll(geometry).toEqual({ bottom: 480, left: 12, header: 48 });
  await expect
    .poll(() => view.locator('.ant-app').evaluate((el) => el.getBoundingClientRect().bottom))
    .toBe(480);
  await view.locator('.ant-app').evaluate((el) => el.scrollTo(0, el.scrollHeight));
  const last = view.locator('.ac-mobile-item').last();
  await expect(last).toBeInViewport();
  expect(await last.evaluate((el) => el.getBoundingClientRect().bottom)).toBeLessThanOrEqual(420);
  await view.locator('.ant-app').evaluate((el) => el.scrollTo(0, 0));
  await view.getByRole('button', { name: '添加物品', exact: true }).click();
  const drawer = view.getByRole('dialog', { name: '入库', exact: true });
  await drawer.getByLabel('入库件数', { exact: true }).fill('7');
  await page.evaluate(() =>
    (window as any).host.frame.contentWindow.postMessage(
      {
        jsonrpc: '2.0',
        method: 'ui/notifications/host-context-changed',
        params: { theme: 'dark' },
      },
      '*',
    ),
  );
  await expect.poll(geometry).toEqual({ bottom: 480, left: 12, header: 48 });
  const drawerGeometry = () =>
    drawer.evaluate((el) => {
      const r = el.getBoundingClientRect();
      return { top: r.top, bottom: r.bottom, left: r.left };
    });
  await expect.poll(drawerGeometry).toEqual({ top: 48, bottom: 480, left: 12 });
  await page.evaluate(() =>
    (window as any).host.frame.contentWindow.postMessage(
      {
        jsonrpc: '2.0',
        method: 'ui/notifications/host-context-changed',
        params: {
          safeAreaInsets: { top: 20, right: 0, bottom: 60, left: 0 },
          containerDimensions: { height: 700 },
        },
      },
      '*',
    ),
  );
  await expect.poll(drawerGeometry).toEqual({ top: 20, bottom: 640, left: 0 });
  await expect(drawer.getByLabel('入库件数', { exact: true })).toHaveValue('7');
  await expect(drawer.getByRole('button', { name: '核对入库信息', exact: true })).toBeInViewport();
});
