import { login } from './login.js';
import { test, expect, type Page } from '@playwright/test';
test.use({ viewport: { width: 390, height: 844 } });
let cookies: Awaited<ReturnType<import('@playwright/test').BrowserContext['cookies']>> = [];
test.beforeAll(async ({ browser }) => {
  if (!process.env.ACORNARY_E2E_CLOUD) return;
  const context = await browser.newContext({ ignoreHTTPSErrors: true });
  const page = await context.newPage();
  await page.goto(process.env.ACORNARY_E2E_ORIGIN! + '/items');
  await login(page);
  await expect(page.getByRole('heading', { name: '我的物品' })).toBeVisible();
  cookies = await context.cookies();
  await context.close();
});
test.beforeEach(async ({ page, context }) => {
  if (cookies.length) await context.addCookies(cookies);
  await page.goto('/items');
  await expect(page.getByRole('heading', { name: '我的物品' })).toBeVisible();
});
async function command(page: Page, name: string, input: Record<string, unknown>) {
  const response = await page.request.post(`/api/write/${name}`, {
    headers: {
      Origin: new URL(page.url()).origin,
      'X-Acornary-Request': 'web',
      'X-Acornary-Household': await page.evaluate(
        () => sessionStorage.getItem('acornary-household') ?? '',
      ),
    },
    data: { idempotency_key: crypto.randomUUID(), ...input },
  });
  expect(response.status(), await response.text()).toBe(200);
  return response.json();
}
async function fixture(page: Page) {
  const name = `Web 演示饮品 ${crypto.randomUUID().slice(0, 6)}`;
  const created = await command(page, 'create_catalog_node', {
    kind: 'SKU',
    name,
    initial_attributes: [
      { template_id: 'product', template_version: 1, values: { specification: '1 L / 瓶' } },
    ],
  });
  const sku = created.affected_objects[0].id;
  const result = await command(page, 'create_items', {
    catalog_node_id: sku,
    count: 6,
    initial_attributes: [
      {
        template_id: 'contents',
        template_version: 1,
        values: { remaining: { value: '1000', unit: 'mL' }, accuracy: 'MEASURED' },
      },
      {
        template_id: 'lifecycle',
        template_version: 1,
        values: { opening: { state: 'SEALED' }, expiry: { date: '2027-06-01' } },
      },
    ],
  });
  return { sku, name, ids: result.affected_objects.map((x: any) => x.id) as string[] };
}
test('six distinct items: intake, open, consume, history and notes persist through real HTTP', async ({
  page,
}) => {
  const f = await fixture(page);
  await page.goto(`/items/group/${f.sku}`);
  await expect(page.getByText('家里还有 6 瓶')).toBeVisible();
  await page.goto(`/items/${f.ids[0]}/details`);
  await page.getByRole('button', { name: '记录开封', exact: true }).click();
  await page.getByRole('button', { name: '保存', exact: true }).click();
  await expect(page.getByRole('dialog')).toHaveCount(0);
  await page.getByRole('button', { name: '记录消耗', exact: true }).click();
  await page.getByLabel('本次消耗量').fill('200');
  await page.getByLabel('数量依据', { exact: true }).selectOption('MEASURED');
  await page.getByRole('button', { name: '确认记录消耗', exact: true }).click();
  await expect(page.getByRole('dialog')).toHaveCount(0);
  await expect(page.locator('.quantity').first()).toHaveText('剩余 800 mL');
  await page.getByRole('link', { name: /变化历史/ }).click();
  await expect(page.locator('.event').filter({ hasText: '部分消耗' })).toContainText(
    '1 L → 800 mL',
  );
  await page.goto(`/items/${f.ids[0]}/notes`);
  await page.getByRole('button', { name: '添加笔记' }).click();
  await page.getByLabel('笔记内容').fill('先用这一瓶。<script>alert(1)</script>');
  await page.getByRole('button', { name: '保存', exact: true }).click();
  await expect(page.getByRole('dialog')).toHaveCount(0);
  await expect(page.locator('.markdown')).toContainText('先用这一瓶');
  expect(await page.locator('.markdown script').count()).toBe(0);
  await page.goto(`/items/group/${f.sku}`);
  await expect(page.getByText('家里还有 6 瓶')).toBeVisible();
  await expect(page.locator('.quantity')).toContainText('5.8 L');
  await page.getByRole('button', { name: '再入库几件' }).click();
  await page.getByLabel('入库件数').fill('2');
  await page.getByRole('button', { name: '核对入库信息' }).click();
  await page.getByRole('button', { name: '确认入库', exact: true }).click();
  await expect(page.getByRole('dialog')).toHaveCount(0);
  await page.goto(`/items/group/${f.sku}`);
  await expect(page.getByText('家里还有 8 瓶')).toBeVisible();
});
test.describe('injected response loss', () => {
  test.use({ serviceWorkers: 'block' });
  test('lost write response retries the same idempotency key, without a second deduction', async ({
    page,
  }) => {
    const f = await fixture(page);
    await page.goto(`/items/${f.ids[0]}/details`);
    const payloads: any[] = [];
    let first = true;
    await page.route('**/api/write/consume_item_content', async (route) => {
      payloads.push(route.request().postDataJSON());
      if (first) {
        first = false;
        await route.fetch();
        await route.abort('failed');
      } else await route.continue();
    });
    await page.getByRole('button', { name: '记录消耗', exact: true }).click();
    await page.getByLabel('本次消耗量').fill('200');
    await page.getByRole('button', { name: '确认记录消耗', exact: true }).click();
    await expect(page.getByRole('alert')).toContainText('连接中断');
    await page.getByRole('button', { name: '重试同一次操作' }).click();
    await expect(page.getByRole('dialog')).toHaveCount(0);
    expect(payloads).toHaveLength(2);
    expect(payloads[0]).toEqual(payloads[1]);
    await expect(page.locator('.quantity').first()).toHaveText('剩余 800 mL');
  });
});
test('concurrent modification requires reviewing fresh data before another submission', async ({
  page,
}) => {
  const f = await fixture(page);
  await page.goto(`/items/${f.ids[0]}/details`);
  await page.getByRole('button', { name: '记录消耗', exact: true }).click();
  await page.getByLabel('本次消耗量').fill('200');
  await command(page, 'consume_item_content', {
    item_id: f.ids[0],
    expected_revisions: { [f.ids[0]]: 1 },
    amount: { value: '100', unit: 'mL' },
    accuracy: 'MEASURED',
  });
  await page.getByRole('button', { name: '确认记录消耗', exact: true }).click();
  await expect(page.getByRole('heading', { name: '核对最新记录' })).toBeVisible();
  await expect(page.getByRole('button', { name: '确认记录消耗', exact: true })).toBeDisabled();
  await page.getByRole('button', { name: '已核对，保留我的输入' }).click();
  await page.getByRole('button', { name: '确认记录消耗', exact: true }).click();
  await expect(page.getByRole('dialog')).toHaveCount(0);
  await expect(page.locator('.quantity').first()).toHaveText('剩余 700 mL');
});
test('offline reload retains inventory and draft, reconnect never automatically writes', async ({
  page,
  context,
  browserName,
}) => {
  test.skip(
    browserName === 'webkit',
    'Playwright 1.63 offline navigation bug: https://github.com/microsoft/playwright/issues/42775; physical Safari acceptance still required.',
  );
  const f = await fixture(page);
  await page.goto(`/items/${f.ids[0]}/details`);
  await page.evaluate(() => navigator.serviceWorker.ready.then(() => true));
  await expect.poll(() => page.evaluate(() => !!navigator.serviceWorker.controller)).toBe(true);
  await page.getByRole('button', { name: '记录消耗', exact: true }).click();
  await page.getByLabel('本次消耗量').fill('123');
  await expect
    .poll(() =>
      page.evaluate(async () => {
        const r = indexedDB.open('acornary-web-v1', 1);
        return new Promise((resolve) => {
          r.onsuccess = () => {
            const q = r.result.transaction('records').objectStore('records').getAll();
            q.onsuccess = () => {
              resolve(q.result.some((v: any) => v?.values?.amount === '123'));
              r.result.close();
            };
          };
        });
      }),
    )
    .toBe(true);
  await context.setOffline(true);
  await page.reload();
  await expect(page.getByLabel('本次消耗量')).toHaveValue('123');
  await expect(page.getByRole('button', { name: '确认记录消耗', exact: true })).toBeDisabled();
  let writes = 0;
  page.on('request', (r) => {
    if (r.url().includes('/api/write/')) writes++;
  });
  await context.setOffline(false);
  await expect(page.getByRole('button', { name: '确认记录消耗', exact: true })).toBeEnabled();
  expect(writes).toBe(0);
  await page.getByRole('button', { name: '确认记录消耗', exact: true }).click();
  await expect(page.getByRole('dialog')).toHaveCount(0);
  await expect(page.locator('.quantity').first()).toHaveText('剩余 877 mL');
});
test('disconnect during editing preserves input and requires manual submission after reconnect', async ({
  page,
  context,
}) => {
  const f = await fixture(page);
  await page.goto(`/items/${f.ids[0]}/details`);
  await page.getByRole('button', { name: '记录消耗', exact: true }).click();
  await page.getByLabel('本次消耗量').fill('75');
  await context.setOffline(true);
  await expect(page.getByRole('button', { name: '确认记录消耗', exact: true })).toBeDisabled();
  await expect(page.getByLabel('本次消耗量')).toHaveValue('75');
  let writes = 0;
  page.on('request', (r) => {
    if (r.url().includes('/api/write/')) writes++;
  });
  await context.setOffline(false);
  await expect(page.getByRole('button', { name: '确认记录消耗', exact: true })).toBeEnabled();
  expect(writes).toBe(0);
  await page.getByRole('button', { name: '确认记录消耗', exact: true }).click();
  await expect(page.getByRole('dialog')).toHaveCount(0);
  await expect(page.locator('.quantity').first()).toHaveText('剩余 925 mL');
});
test('mobile and desktop layouts, long names and accessible touch targets', async ({ page }) => {
  for (const width of [360, 390, 430, 1440]) {
    await page.setViewportSize({ width, height: 900 });
    await page.goto('/items');
    await expect(page.getByRole('heading', { name: '我的物品' })).toBeVisible();
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(
      true,
    );
    await page.screenshot({ path: `output/playwright/webui-${width}.png`, fullPage: true });
  }
  const desktop = await fixture(page);
  await page.goto(
    `/catalog/${desktop.sku}?dialog=attributes&target=${desktop.sku}&template=product`,
  );
  await expect(page.locator('.editor-page')).toBeVisible();
  await expect(page.getByRole('dialog')).toHaveCount(0);
  await page.getByLabel('品牌', { exact: true }).fill('桌面输入保留');
  await page.screenshot({ path: 'output/playwright/webui-desktop-editor.png', fullPage: true });
  await page.setViewportSize({ width: 360, height: 640 });
  await expect(page.getByRole('dialog')).toBeVisible();
  await expect(page.getByLabel('品牌', { exact: true })).toHaveValue('桌面输入保留');
  await page.getByRole('button', { name: '关闭', exact: true }).click();
  await page.goto('/items');
  await page.getByRole('button', { name: '添加', exact: true }).click();
  await page.getByRole('button', { name: '创建新商品' }).click();
  await page
    .getByLabel('名称', { exact: true })
    .fill('长中文名称用于验证小屏幕布局和输入法弹出后的保存按钮是否仍然可达'.repeat(4));
  const button = page.getByRole('button', { name: '保存', exact: true });
  await button.scrollIntoViewIfNeeded();
  expect((await button.boundingBox())!.height).toBeGreaterThanOrEqual(44);
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  await page.screenshot({ path: 'output/playwright/webui-form-360.png' });
});
test('moving a container keeps child identities and updates their displayed paths', async ({
  page,
}) => {
  const snapshot = await (
    await page.request.get('/api/ui/snapshot', {
      headers: {
        'X-Acornary-Household': await page.evaluate(
          () => sessionStorage.getItem('acornary-household') ?? '',
        ),
      },
    })
  ).json();
  const container = async (name: string, parent_id: string | null = null) =>
    (
      await command(page, 'create_items', {
        catalog_node_id: snapshot.container_catalog_id,
        count: 1,
        display_name: name,
        parent_id,
        initial_attributes: [
          { template_id: 'container', template_version: 1, values: { can_contain: true } },
        ],
      })
    ).affected_objects[0].id as string;
  const suffix = crypto.randomUUID().slice(0, 5);
  const bedroom = await container(`卧室 ${suffix}`),
    study = await container(`书房 ${suffix}`),
    box = await container(`收纳箱 ${suffix}`, bedroom);
  const f = await fixture(page);
  await command(page, 'move_item', {
    item_id: f.ids[0],
    parent_id: box,
    expected_revisions: { [f.ids[0]]: 1 },
  });
  await page.goto(`/places/${box}`);
  await page.getByText('位置操作', { exact: true }).click();
  await page.getByRole('button', { name: '移动位置', exact: true }).click();
  await expect(page.getByRole('dialog')).toContainText('内部所有物品和子容器会一起移动');
  await page.getByRole('searchbox', { name: '搜索目标位置' }).fill(`书房 ${suffix}`);
  await page.getByRole('button', { name: new RegExp(`书房 ${suffix} 0`) }).click();
  await page.getByRole('button', { name: '确认移动 1 件', exact: true }).click();
  await expect(page.getByRole('dialog')).toHaveCount(0);
  await page.goto(`/items/${f.ids[0]}/details`);
  await expect(page.locator('.page-header')).toContainText(`书房 ${suffix} / 收纳箱 ${suffix}`);
  const after = await (
    await page.request.get('/api/ui/snapshot', {
      headers: {
        'X-Acornary-Household': await page.evaluate(
          () => sessionStorage.getItem('acornary-household') ?? '',
        ),
      },
    })
  ).json();
  expect(after.items.find((i: any) => i.id === f.ids[0])).toMatchObject({
    parent_id: box,
    revision: 2,
  });
});
test('catalog templates, single-item finish and reasoned correction are editable', async ({
  page,
}) => {
  const f = await fixture(page);
  await page.goto(`/catalog/${f.sku}`);
  await page.getByRole('button', { name: '编辑共有资料' }).click();
  await page.getByRole('button', { name: '衣物资料', exact: true }).click();
  await page.getByLabel('材质', { exact: true }).fill('棉');
  await page.getByLabel('尺码', { exact: true }).fill('M');
  await page.getByRole('button', { name: '保存', exact: true }).click();
  await expect(page.getByRole('dialog')).toHaveCount(0);
  await expect(page.locator('.card').filter({ hasText: '衣物资料' })).toContainText('棉');
  await page.goto(`/items/${f.ids[0]}/details`);
  await page.getByRole('button', { name: '整件用完', exact: true }).click();
  await page.getByRole('button', { name: '确认整件用完', exact: true }).click();
  await expect(page.getByRole('dialog')).toHaveCount(0);
  await expect(page.locator('.quantity').first()).toHaveText('剩余 0 mL');
  await page.getByRole('button', { name: '纠正记录', exact: true }).click();
  await page.getByRole('button', { name: '状态与日期', exact: true }).click();
  await page.getByLabel('生命周期', { exact: true }).selectOption('ACTIVE');
  await page.getByLabel('剩余内容', { exact: true }).fill('500');
  await page.getByLabel('纠错原因', { exact: true }).fill('误点用完，重新核对仍有 500 mL');
  await page.getByRole('button', { name: '保存', exact: true }).click();
  await expect(page.getByRole('dialog')).toHaveCount(0);
  await expect(page.locator('.quantity').first()).toHaveText('剩余 500 mL');
  await page.getByRole('link', { name: /变化历史/ }).click();
  await expect(page.locator('.event').filter({ hasText: '纠正记录' })).toContainText('误点用完');
});
test('Soft Gray search pages the complete hierarchy and retains catalog and SKU return state', async ({
  page,
}) => {
  const f = await fixture(page);
  await command(page, 'create_items', { catalog_node_id: f.sku, count: 24 });
  await page.goto('/items');
  await page.getByRole('link', { name: '验收储藏室', exact: true }).click();
  await page.getByRole('link', { name: '验收行李箱', exact: true }).click();
  await expect(page.locator('.wb-table tbody tr')).toHaveCount(6);
  for (const width of [390, 1280]) {
    await page.setViewportSize({ width, height: 900 });
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(
      true,
    );
    await expect(page.locator('.wb-inventory')).toBeVisible();
    await page.screenshot({ path: `output/playwright/workbench-location-${width}.png` });
  }
  await page.goto('/catalog');
  await page.getByRole('searchbox', { name: '搜索商品名称或规格' }).fill(f.name);
  await page.screenshot({ path: 'output/playwright/soft-catalog-1280.png' });
  await page.locator('.soft-row').filter({ hasText: f.name }).click();
  await expect(page.locator('.soft-row')).toHaveCount(20);
  await page.getByRole('button', { name: '加载更多', exact: true }).click();
  await expect(page.locator('.soft-row')).toHaveCount(30);
  await page.locator('.soft-row').last().click();
  await page.getByRole('link', { name: '返回', exact: true }).click();
  await expect(page.locator('.soft-row')).toHaveCount(30);
  await expect(page.locator('.soft-row').last()).toBeVisible();
  await page.getByRole('link', { name: '返回', exact: true }).click();
  await expect(page.getByRole('searchbox', { name: '搜索商品名称或规格' })).toHaveValue(f.name);
  await page.goto('/search');
  await page.getByRole('searchbox', { name: '搜索物品、规格或位置' }).fill(f.name);
  await expect(page.locator('.soft-row')).toHaveCount(20);
  await expect(page.locator('.page-end')).toContainText('30 条');
  await page.getByRole('button', { name: '加载更多', exact: true }).click();
  await expect(page.locator('.soft-row')).toHaveCount(30);
  await expect(page.locator('.item-identity').filter({ hasText: f.ids[0] })).toHaveCount(1);
  for (const width of [360, 600, 1280]) {
    await page.setViewportSize({ width, height: 900 });
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(
      true,
    );
    await page.screenshot({ path: `output/playwright/soft-search-${width}.png` });
  }
  await page.locator('.soft-page').getByRole('button', { name: '清除搜索' }).click();
  await page.getByRole('searchbox', { name: '搜索物品、规格或位置' }).fill('验收牛奶');
  await page
    .getByRole('combobox', { name: '搜索范围', exact: true })
    .selectOption({ label: '全部位置 / 验收储藏室及下级位置' });
  await expect(page.locator('.soft-row')).toHaveCount(6);
  await expect(page.locator('.soft-row').first()).toContainText('验收储藏室 / 验收行李箱');
  await page
    .getByRole('combobox', { name: '搜索范围', exact: true })
    .selectOption({ label: '全部位置 / 验收厨房及下级位置' });
  await expect(page.getByRole('heading', { name: '没有找到匹配结果' })).toBeVisible();
});

test('Soft Gray consumption validates inline and moving requires a separate path confirmation', async ({
  page,
}) => {
  const f = await fixture(page);
  await page.goto(`/items/${f.ids[0]}/details`);
  await page.getByRole('button', { name: '记录消耗', exact: true }).click();
  for (const value of ['0', '-1', '1001', 'Infinity', 'NaN']) {
    await page.getByLabel('本次消耗量', { exact: true }).fill(value);
    await expect(page.getByRole('button', { name: '确认记录消耗', exact: true })).toBeDisabled();
    await expect(page.locator('.consume-preview')).toHaveCount(0);
    await expect(page.getByLabel('本次消耗量', { exact: true })).toHaveAttribute(
      'aria-invalid',
      'true',
    );
  }
  await page.getByLabel('本次消耗量', { exact: true }).fill('200');
  await expect(page.locator('.consume-preview')).toContainText('800 mL');
  for (const width of [390, 1280]) {
    await page.setViewportSize({ width, height: 900 });
    await page.screenshot({ path: `output/playwright/soft-consume-${width}.png`, fullPage: true });
  }
  await page.getByRole('button', { name: '取消', exact: true }).click();
  await page.setViewportSize({ width: 390, height: 844 });
  await page.getByRole('button', { name: '移动位置', exact: true }).click();
  await expect(page.getByRole('button', { name: '确认移动 1 件' })).toBeDisabled();
  await page.getByRole('searchbox', { name: '搜索目标位置' }).fill('验收厨房');
  await page.getByRole('button', { name: /^验收厨房 \d+$/ }).click();
  let writes = 0;
  page.on('request', (request) => {
    if (request.url().includes('/api/write/move_item')) writes++;
  });
  await expect(page.locator('.wb-move-confirmation')).toContainText('全部位置 / 验收厨房');
  expect(writes).toBe(0);
  await page.screenshot({ path: 'output/playwright/workbench-move-confirm-390.png' });
  await page.getByRole('button', { name: '确认移动 1 件', exact: true }).click();
  await expect(page.getByRole('dialog')).toHaveCount(0);
  expect(writes).toBe(1);
  await expect(page.locator('.page-header')).toContainText('验收厨房');
  await page.getByRole('button', { name: '移动位置', exact: true }).click();
  await expect(page.getByRole('button', { name: '确认移动 1 件' })).toBeDisabled();
});

test.describe('Soft Gray committed write recovery', () => {
  test.use({ serviceWorkers: 'block' });
  test('a successful write with failed refresh can reread without another write', async ({
    page,
  }) => {
    const f = await fixture(page);
    await page.goto(`/items/${f.ids[0]}/details`);
    await page.getByRole('button', { name: '记录消耗', exact: true }).click();
    await page.getByLabel('本次消耗量', { exact: true }).fill('150');
    let writes = 0;
    page.on('request', (request) => {
      if (request.url().includes('/api/write/consume_item_content')) writes++;
    });
    await page.route('**/api/ui/snapshot', (route) => route.abort('failed'));
    await page.getByRole('button', { name: '确认记录消耗', exact: true }).click();
    await expect(page.getByRole('button', { name: '刷新查看结果' })).toBeEnabled();
    await page.unroute('**/api/ui/snapshot');
    await page.getByRole('button', { name: '刷新查看结果' }).click();
    await expect(page.getByRole('dialog')).toHaveCount(0);
    expect(writes).toBe(1);
    await expect(page.locator('.quantity').first()).toHaveText('剩余 850 mL');
  });
});

test('session expiry preserves the exact pending edit and logout clears private caches', async ({
  page,
}) => {
  test.skip(!process.env.ACORNARY_E2E_CLOUD, 'Secure session boundary');
  const f = await fixture(page);
  await page.goto(`/items/${f.ids[0]}/details`);
  await page.getByRole('button', { name: '记录消耗', exact: true }).click();
  await page.getByLabel('本次消耗量').fill('175');
  await page.request.post('/api/auth/sign-out', {
    headers: { Origin: new URL(page.url()).origin },
    data: {},
  });
  await page.getByRole('button', { name: '确认记录消耗', exact: true }).click();
  const loginDialog = page
    .getByRole('dialog')
    .filter({ has: page.getByRole('heading', { name: '重新登录', exact: true }) });
  await expect(loginDialog).toBeVisible();
  await login(page);
  await expect(loginDialog).toHaveCount(0);
  await expect(page.getByLabel('本次消耗量')).toHaveValue('175');
  await page.getByRole('button', { name: '重试同一次操作' }).click();
  await expect(page.getByRole('dialog')).toHaveCount(0);
  await expect(page.locator('.quantity').first()).toHaveText('剩余 825 mL');
  await page.goto('/settings');
  await page.getByRole('button', { name: '退出登录并清除本机缓存' }).click();
  await expect(page.getByRole('heading', { name: '欢迎回到松仓' })).toBeVisible();
  expect(await page.evaluate(() => localStorage.getItem('acornary-account'))).toBeNull();
  expect(
    await page.evaluate(async () => {
      const r = indexedDB.open('acornary-web-v1', 1);
      return new Promise((resolve) => {
        r.onsuccess = () => {
          const q = r.result.transaction('records').objectStore('records').count();
          q.onsuccess = () => {
            resolve(q.result);
            r.result.close();
          };
        };
      });
    }),
  ).toBe(0);
});
