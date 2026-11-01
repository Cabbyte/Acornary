import { expect, test } from '@playwright/test';
import { login } from './login.js';

test.describe('next inventory UI', () => {
  test.beforeEach(async ({ page }) => {
    await page.goto('/items?ui=next');
    if (process.env.ACORNARY_E2E_CLOUD) {
      await login(page);
      await page.goto('/items?ui=next');
    }
    await expect(page.getByRole('heading', { name: '我的物品', exact: true })).toBeVisible();
  });

  test('renders the new shell and list without raw ids', async ({ page }) => {
    await expect(page.getByRole('button', { name: '添加物品', exact: true })).toBeVisible();
    await expect(page.getByRole('link', { name: '商品目录', exact: true }).first()).toBeVisible();
    const text = await page.locator('body').innerText();
    expect(text).not.toMatch(/item_[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}/);
    await expect(page.locator('select')).toHaveCount(0);
  });

  test('attention and location views are URL-backed', async ({ page }) => {
    await page
      .getByRole('link', { name: /需留意/ })
      .first()
      .click();
    await expect(page).toHaveURL(/view=attention/);
    await page.goto('/items?ui=next');
    const location = page.getByRole('link', { name: /厨房|餐厅|卧室|阳台/, exact: false }).first();
    await expect(location).toBeVisible();
    await location.click();
    await expect(page).toHaveURL(/\/places\//);
  });

  test('renders catalog and activity through the new shell', async ({ page }) => {
    await page.goto('/catalog?ui=next');
    await expect(page.getByRole('heading', { name: '商品目录', exact: true })).toBeVisible();
    await expect(page.getByRole('button', { name: '新增商品', exact: true })).toBeVisible();
    await page.goto('/activity?ui=next');
    await expect(page.getByRole('heading', { name: '动态', exact: true })).toBeVisible();
  });

  test('renders the new settings screen', async ({ page }) => {
    await page.goto('/settings?ui=next');
    await expect(page.getByRole('heading', { name: '设置', exact: true })).toBeVisible();
    await expect(page.getByText('本机缓存', { exact: true })).toBeVisible();
    await expect(page.getByText('打印机与标签', { exact: true })).toBeVisible();
  });

  test('keeps the mobile bottom navigation reachable', async ({ page }) => {
    await page.setViewportSize({ width: 390, height: 844 });
    await page.goto('/items?ui=next');
    await expect(page.getByRole('navigation', { name: '底部导航' })).toBeVisible();
    await expect(page.getByRole('link', { name: '设置', exact: true }).last()).toBeVisible();
  });
});

test('legacy rollback keeps old selectors across plain navigation', async ({ page }) => {
  await page.goto('/items?ui=legacy');
  await expect(page.getByRole('searchbox', { name: '搜索物品、规格、位置…' })).toBeVisible();
  await page.goto('/items');
  await expect(page.getByRole('searchbox', { name: '搜索物品、规格、位置…' })).toBeVisible();
  await page.goto('/items?ui=next');
  await expect(page.getByRole('button', { name: '添加物品', exact: true })).toBeVisible();
});

test('search, category, location and sort survive reload and history navigation', async ({
  page,
}) => {
  await page.goto('/items?ui=next');
  await expect(page.getByRole('button', { name: '添加物品', exact: true })).toBeVisible();
  const snapshot = await (await page.request.get('/api/ui/snapshot')).json();
  const located = snapshot.items.find(
    (i: any) => i.parent_id && !i.attributes.some((a: any) => a.template_id === 'container'),
  );
  const product = snapshot.catalog.find((c: any) => c.id === located.catalog_node_id);
  const params = new URLSearchParams({
    ui: 'next',
    q: product.name,
    location: located.parent_id,
    category: product.id,
    sort: 'name',
  });
  await page.goto('/items?' + params);
  await expect(page.getByRole('searchbox', { name: '搜索物品', exact: true })).toHaveValue(
    product.name,
  );
  await expect(page.getByRole('button', { name: '按名称', exact: true })).toBeVisible();
  await expect(page.locator('main a[href*="/items/item_"]').first()).toBeVisible();
  await page.reload();
  await expect(page.getByRole('searchbox', { name: '搜索物品', exact: true })).toHaveValue(
    product.name,
  );
  await page.getByRole('button', { name: /^需留意/ }).click();
  await expect(page).toHaveURL(/view=attention/);
  expect(new URL(page.url()).searchParams.get('q')).toBe(product.name);
  expect(new URL(page.url()).searchParams.has('cursor')).toBe(false);
  await page.goBack();
  await expect(page).not.toHaveURL(/view=attention/);
  await page.keyboard.press('/');
  await expect(page.getByRole('searchbox', { name: '搜索物品', exact: true })).toBeFocused();
});

for (const viewport of [
  { width: 1440, height: 1000 },
  { width: 1024, height: 1000 },
  { width: 390, height: 844 },
]) {
  test(`list, detail and write sheet at ${viewport.width} have no overflow or console errors`, async ({
    page,
  }) => {
    const errors: string[] = [];
    page.on('pageerror', (error) => errors.push(error.message));
    page.on('console', (message) => {
      if (message.type() === 'error') errors.push(message.text());
    });
    await page.setViewportSize(viewport);
    await page.goto('/items?ui=next');
    const rows = page.locator('main a[href*="/items/item_"]');
    await expect(rows.first()).toBeVisible();
    await expect(page.locator('select')).toHaveCount(0);
    expect(await page.locator('body').innerText()).not.toMatch(/item_[0-9a-f]{8}-/);
    expect(
      await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth),
    ).toBe(true);
    await page.screenshot({
      animations: 'disabled',
      path: `output/next/list-${viewport.width}.png`,
    });
    // Other suites create items without content; select a real consumable through list search.
    const snapshot = await (await page.request.get('/api/ui/snapshot')).json();
    const consumable = snapshot.items.find(
      (item: any) =>
        item.display_name &&
        item.attributes.some(
          (a: any) => a.template_id === 'contents' && Number(a.values.remaining?.value) > 0,
        ) &&
        !item.attributes.some(
          (a: any) =>
            a.template_id === 'lifecycle' && ['CONSUMED', 'DISPOSED'].includes(a.values.state),
        ),
    );
    await page
      .getByRole('searchbox', { name: '搜索物品', exact: true })
      .fill(consumable.display_name);
    const row = page.locator(`main a[href^="/items/${consumable.id}?"]`);
    await row.click();
    await expect(page).toHaveURL(/\/items\/item_/);
    await expect(page.getByRole('heading', { name: '资料', exact: true })).toBeVisible();
    await page.screenshot({
      animations: 'disabled',
      path: `output/next/detail-${viewport.width}.png`,
    });
    expect(await page.locator('body').innerText()).not.toMatch(/item_[0-9a-f]{8}-/);
    await page.getByRole('button', { name: '记录消耗', exact: true }).click();
    await expect(page.getByLabel('本次消耗量', { exact: true })).toBeFocused();
    await page.getByLabel('本次消耗量', { exact: true }).fill('1');
    await expect(page.locator('select')).toHaveCount(0);
    expect(
      await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth),
    ).toBe(true);
    await page.screenshot({
      animations: 'disabled',
      path: `output/next/consume-${viewport.width}.png`,
    });
    expect(errors).toEqual([]);
  });
}

test('core routes default to the new UI without an opt-in flag', async ({ page }) => {
  await page.goto('/items');
  await expect(page.getByRole('button', { name: '添加物品', exact: true })).toBeVisible();
  await expect(page.getByRole('searchbox', { name: '搜索物品', exact: true })).toBeVisible();
  await expect(
    page.getByRole('searchbox', { name: '搜索物品、规格、位置…', exact: true }),
  ).toHaveCount(0);
  await page.goto('/settings');
  await expect(page.getByText('打印机与标签', { exact: true })).toBeVisible();
});

test('opaque cursors are cleared when filters change and INVALID_CURSOR returns to page one', async ({
  page,
}) => {
  let firstPage: any;
  const inputs: any[] = [];
  let invalid = false;
  await page.route('**/api/read/query_items?*', async (route) => {
    const input = JSON.parse(new URL(route.request().url()).searchParams.get('input')!);
    inputs.push(input);
    if (!firstPage) firstPage = await (await route.fetch()).json();
    if (input.cursor && !invalid) {
      invalid = true;
      await route.fulfill({
        status: 400,
        contentType: 'application/json',
        json: { error: { code: 'INVALID_CURSOR', request_id: 'cursor-test' } },
      });
    } else {
      await route.fulfill({
        json: { ...firstPage, next_cursor: invalid ? null : 'opaque-page-token' },
      });
    }
  });
  await page.goto('/items?ui=next');
  await page.getByRole('button', { name: '加载更多', exact: true }).click();
  await expect.poll(() => inputs.length).toBeGreaterThanOrEqual(3);
  expect(inputs[1].cursor).toBe('opaque-page-token');
  expect(inputs.at(-1).cursor).toBeUndefined();
  await page.getByRole('searchbox', { name: '搜索物品', exact: true }).fill('牛奶');
  await expect.poll(() => inputs.at(-1).search).toBe('牛奶');
  expect(inputs.at(-1).cursor).toBeUndefined();
  expect(new URL(page.url()).searchParams.has('cursor')).toBe(false);
});
