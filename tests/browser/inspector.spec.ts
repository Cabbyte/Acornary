import { fixtureRead } from './governance.js';
import { choose } from './controls.js';
import { login } from './login.js';
import { test, expect } from './legacy.js';
test.beforeEach(async ({ page }) => {
  if (!process.env.ACORNARY_E2E_CLOUD) return;
  await page.goto('/inspect');
  await login(page);
  await expect(page.getByRole('button', { name: '退出登录' })).toBeVisible();
});
test('database rows, foreign keys, derived paths, APIs, notes and fixed registry views', async ({
  page,
}) => {
  const errors: string[] = [];
  const methods: string[] = [];
  page.on('pageerror', (e) => errors.push(e.message));
  page.on('request', (r) => {
    if (r.url().includes('/api/')) {
      methods.push(r.method());
      expect(r.url()).not.toContain('/api/write/');
      if (r.method() === 'POST') expect(r.url()).toContain('/api/read/');
      expect(r.headers().authorization).toBeUndefined();
    }
  });
  page.on('dialog', () => {
    throw new Error('Unsafe note HTML');
  });
  await page.goto('/inspect');
  await expect(page.getByRole('heading', { name: 'CatalogNode 目录树' })).toBeVisible();
  await expect(page.getByRole('heading', { name: 'Item 容纳树' })).toBeVisible();
  await page.getByLabel('搜索名称').fill('验收牛奶 1L');
  const rows = page.locator('main > .panel').first().locator('tbody tr[data-row-key]');
  await expect(rows).toHaveCount(6);
  await choose(page, '生命周期过滤', 'ACTIVE');
  await expect(rows).toHaveCount(0);
  await choose(page, '生命周期过滤', '全部生命周期');
  await page.getByLabel('到期日期上限').fill('2026-09-30');
  await page.getByLabel('到期日期上限').press('Enter');
  await expect(rows).toHaveCount(0);
  await page.getByLabel('到期日期上限').click();
  await page.getByLabel('到期日期上限').fill('2026-10-01');
  await page.getByLabel('到期日期上限').press('Enter');
  await page.getByLabel('查询条码').fill('TEST-MILK-1L');
  await expect(rows).toHaveCount(6);
  const milk = await fixtureRead(page);
  const sku = milk.catalog.find((node: any) => node.name === '验收牛奶 1L');
  const noted = milk.items.find(
    (item: any) => item.catalog_node_id === sku.id && item.note_count > 0,
  );
  expect(noted).toBeTruthy();
  await rows.filter({ hasText: noted.id }).getByRole('button').click();
  const core = page.getByTestId('records-items');
  await expect(core).toBeVisible();
  await expect(core.getByLabel('items · 行 1', { exact: true })).toContainText('item_');
  await expect(core.getByLabel('items · 行 1', { exact: true })).not.toContainText('path_ids');
  await expect(core.getByLabel('items · 行 1', { exact: true })).toContainText('redacted_paths');
  const response = await page.request.get(
    '/api/debug?input=' +
      encodeURIComponent(
        JSON.stringify({
          view: 'object',
          table: 'items',
          target: { kind: 'ITEM', id: noted.id },
          limit: 200,
        }),
      ),
    {
      headers: {
        'X-Acornary-Household': await page.evaluate(
          () => sessionStorage.getItem('acornary-household') ?? '',
        ),
      },
    },
  );
  const db = (await response.json()).rows;
  const raw = JSON.parse((await core.getByLabel('items · 行 1', { exact: true }).textContent())!);
  expect(raw).toEqual(db.find((r: any) => r.id === raw.id));
  expect(raw).not.toHaveProperty('attributes');
  expect(raw).not.toHaveProperty('display_name');
  expect(raw.redacted_paths).toContain('attributes');
  await expect(page.getByTestId('embedded-attributes').locator('.binding')).toHaveCount(0);
  const notes = page.getByTestId('records-notes');
  const note = JSON.parse((await notes.getByLabel('notes · 行 1', { exact: true }).textContent())!);
  expect(note).not.toHaveProperty('body');
  expect(note).not.toHaveProperty('title');
  expect(note).not.toHaveProperty('item_id');
  expect(note.target_kind).toBe('ITEM');
  expect(note.target_id).toBe(raw.id);
  await expect(notes.locator('script')).toHaveCount(0);
  await expect(page.getByTestId('records-events')).toContainText('NOTE_UPDATE');
  await page.screenshot({ path: 'output/playwright/database-records.png', fullPage: true });
  await page.getByRole('tab', { name: '派生结果（非存储）', exact: true }).click();
  await expect(page.getByTestId('derived')).toContainText('path_ids');
  const derived = JSON.parse((await page.getByTestId('derived').locator('pre').textContent())!);
  expect(derived.path_ids).toHaveLength(3);
  expect(derived.path_ids.every((s: string) => s.startsWith('item_'))).toBe(true);
  await page.getByRole('tab', { name: 'API 响应', exact: true }).click();
  await expect(page.getByTestId('api-response')).toContainText('attributes');
  expect(
    JSON.parse((await page.getByTestId('api-response').locator('pre').textContent())!),
  ).not.toHaveProperty('object_kind');
  const projection = JSON.parse(
    (await page.getByTestId('api-response').locator('pre').textContent())!,
  );
  for (const a of projection.attributes)
    expect(Object.keys(a).sort()).toEqual(['template_id', 'template_version', 'values']);
  await page.getByRole('tab', { name: '数据库记录', exact: true }).click();
  await core
    .locator('.references button')
    .filter({ hasText: /^catalog_node_/ })
    .click();
  await expect(page.getByTestId('records-catalog_nodes')).toBeVisible();
  await page.getByRole('button', { name: '查看关联物品' }).click();
  await expect(rows).toHaveCount(6);
  await page.locator('nav button').filter({ hasText: '模板定义' }).click();
  await choose(page, 'attribute_templates 每页条数', '50');
  await expect(page.getByTestId('records-attribute_templates')).toContainText('lifecycle');
  await page.locator('nav button').filter({ hasText: '操作记录' }).click();
  const ops = page.getByTestId('records-operations');
  await expect(ops.locator('.record')).toHaveCount(10);
  await ops.getByRole('button', { name: '下一页', exact: true }).click();
  await expect(ops).toContainText('第 2 页');
  await ops.getByRole('button', { name: '上一页', exact: true }).click();
  await expect(ops).toContainText('第 1 页');
  await page.locator('nav button').filter({ hasText: '迁移信息' }).click();
  await expect(page.getByTestId('records-migrations')).toContainText(
    process.env.ACORNARY_E2E_NATIVE ? 'version' : '003_embed_attributes.sql',
  );
  await page.screenshot({ path: 'output/playwright/inspector.png', fullPage: true });
  expect(new Set(methods)).toEqual(new Set(['GET', 'POST']));
  expect(errors).toEqual([]);
  await expect(page.locator('button').filter({ hasText: /保存|删除|上传|入库/ })).toHaveCount(0);
});
test('polling, focus and manual refresh remain read-only', async ({ page }) => {
  const seen: string[] = [];
  page.on('request', (r) => {
    if (r.url().includes('/api/')) seen.push(r.url());
  });
  await page.goto('/inspect');
  await expect(page.getByTestId('records-households').locator('.record')).toHaveCount(1);
  await page.waitForLoadState('networkidle');
  const count = seen.length;
  await expect.poll(() => seen.length, { timeout: 8000 }).toBeGreaterThan(count);
  await page.waitForLoadState('networkidle');
  const after = seen.length;
  await page.evaluate(() => {
    // Model leaving and returning to the page. A second focus event while the
    // query client is already focused is intentionally deduplicated.
    const prior = Object.getOwnPropertyDescriptor(document, 'visibilityState');
    Object.defineProperty(document, 'visibilityState', { configurable: true, value: 'hidden' });
    document.dispatchEvent(new Event('visibilitychange'));
    if (prior) Object.defineProperty(document, 'visibilityState', prior);
    else Reflect.deleteProperty(document, 'visibilityState');
    window.dispatchEvent(new FocusEvent('focus'));
  });
  await expect.poll(() => seen.length, { timeout: 2000 }).toBeGreaterThan(after);
  await page.waitForLoadState('networkidle');
  const manual = seen.length;
  await page.getByRole('button', { name: '刷新数据', exact: true }).click();
  await expect.poll(() => seen.length, { timeout: 2000 }).toBeGreaterThan(manual);
});

test('a completed query preserves an unsubmitted expiry date edit', async ({ page }) => {
  await page.goto('/inspect');
  const panel = page.locator('main > .panel').first();
  const rows = panel.locator('tbody tr[data-row-key]');
  const expiry = page.getByLabel('到期日期上限');
  await page.getByLabel('搜索名称').fill('验收牛奶 1L');
  await expect(rows).toHaveCount(6);

  let releaseQuery!: () => void;
  const queryReleased = new Promise<void>((resolve) => {
    releaseQuery = resolve;
  });
  let queryReady!: () => void;
  const heldQuery = new Promise<void>((resolve) => {
    queryReady = resolve;
  });
  let held = false;
  await page.route('**/api/read/query_items', async (route) => {
    const input = route.request().postDataJSON();
    if (
      !held &&
      input.attribute_filters?.some(
        (filter: any) => filter.path === 'expiry.date' && filter.value === '2026-09-30',
      )
    ) {
      held = true;
      const response = await route.fetch();
      queryReady();
      await queryReleased;
      await route.fulfill({ response });
    } else {
      await route.continue();
    }
  });
  try {
    await expiry.fill('2026-09-30');
    await expiry.press('Enter');
    await heldQuery;
    await expiry.click();
    await expiry.fill('2026-10-01');
    await expect(expiry).toHaveValue('2026-10-01');
    releaseQuery();
    await expect(panel).toContainText('matching_count: 0');
    await expect(expiry).toHaveValue('2026-10-01');
    await expiry.press('Enter');
    await expect(rows).toHaveCount(6);
    await page.getByLabel('查询条码').fill('TEST-MILK-1L');
    await expect(rows).toHaveCount(6);
  } finally {
    releaseQuery();
  }
});
