import { fixtureCommand, fixtureRead } from './governance.js';
import { choose } from './controls.js';
import { login } from './login.js';
import { test, expect, type Page } from './legacy.js';
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
  return fixtureCommand(page, name, input);
}
async function fixture(page: Page) {
  const name = `Web 演示饮品 ${crypto.randomUUID().slice(0, 6)}`;
  const created = await command(page, 'create_catalog_node', {
    kind: 'SKU',
    profile: 'CONSUMABLE',
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
        template_version: 2,
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
  await expect(page.locator('main a[href*="/items/item_"]')).toHaveCount(6);
  await page.goto(`/items/${f.ids[0]}`);
  await page.getByText('更多', { exact: true }).click();
  await page.getByRole('button', { name: '记录开封', exact: true }).click();
  await page.getByRole('button', { name: '保存', exact: true }).click();
  await expect(page.getByRole('dialog')).toHaveCount(0);
  await page.getByRole('button', { name: '记录消耗', exact: true }).click();
  await page.getByLabel('本次消耗量').fill('200');
  await choose(page, '数量依据', '实测值');
  await page.getByRole('button', { name: '确认记录消耗', exact: true }).click();
  await expect(page.getByRole('dialog')).toHaveCount(0);
  await expect(page.getByText('800 mL', { exact: true }).first()).toBeVisible();
  await expect(page.getByText('部分消耗', { exact: true })).toBeVisible();
  await page.goto(`/items/${f.ids[0]}`);
  await page.getByRole('button', { name: '添加笔记' }).click();
  await page.getByLabel('笔记内容').fill('先用这一瓶。<script>alert(1)</script>');
  await page.getByRole('button', { name: '保存', exact: true }).click();
  await expect(page.getByRole('dialog')).toHaveCount(0);
  await expect(page.getByText(/先用这一瓶/)).toBeVisible();
  expect(await page.locator('main script').count()).toBe(0);
  await page.goto(`/items/group/${f.sku}`);
  await expect(page.locator('main a[href*="/items/item_"]')).toHaveCount(6);
  const totals = await fixtureRead(page, 'query_items', { catalog_node_ids: [f.sku] });
  expect(totals.content_totals.by_unit.mL.value).toBe('5800');
  await page.goto(`/catalog/${f.sku}`);
  await page.getByRole('button', { name: '新增实物', exact: true }).click();
  await page.getByLabel('入库件数').fill('2');
  await page.getByRole('button', { name: '核对入库信息' }).click();
  await page.getByRole('button', { name: '确认入库', exact: true }).click();
  await expect(page.getByRole('dialog')).toHaveCount(0);
  await page.goto(`/items/group/${f.sku}`);
  await expect(page.locator('main a[href*="/items/item_"]')).toHaveCount(8);
});
test.describe('injected response loss', () => {
  test.use({ serviceWorkers: 'block' });
  test('lost write response retries the same idempotency key, without a second deduction', async ({
    page,
  }) => {
    const f = await fixture(page);
    await page.goto(`/items/${f.ids[0]}`);
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
    await expect(page.getByText('800 mL', { exact: true }).first()).toBeVisible();
  });
});
test('concurrent modification requires reviewing fresh data before another submission', async ({
  page,
}) => {
  const f = await fixture(page);
  await page.goto(`/items/${f.ids[0]}`);
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
  await expect(page.getByText('700 mL', { exact: true }).first()).toBeVisible();
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
  await page.goto(`/items/${f.ids[0]}`);
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
  await expect(page.getByText('877 mL', { exact: true }).first()).toBeVisible();
});
test('disconnect during editing preserves input and requires manual submission after reconnect', async ({
  page,
  context,
}) => {
  const f = await fixture(page);
  await page.goto(`/items/${f.ids[0]}`);
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
  await expect(page.getByText('925 mL', { exact: true }).first()).toBeVisible();
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
  await expect(page.getByRole('dialog')).toBeVisible();
  await page.getByLabel('品牌', { exact: true }).fill('桌面输入保留');
  await page.screenshot({ path: 'output/playwright/webui-desktop-editor.png', fullPage: true });
  await page.setViewportSize({ width: 360, height: 640 });
  await expect(page.getByRole('dialog')).toBeVisible();
  await expect(page.getByLabel('品牌', { exact: true })).toHaveValue('桌面输入保留');
  await page.getByRole('button', { name: '取消', exact: true }).click();
  await page.getByRole('button', { name: '保留草稿并关闭', exact: true }).click();
  await page.goto('/items');
  await page.getByRole('button', { name: '添加物品', exact: true }).click();
  await page.getByRole('button', { name: '创建新商品' }).click();
  await page
    .getByLabel('新商品名称', { exact: true })
    .fill('长中文名称用于验证小屏幕布局和输入法弹出后的保存按钮是否仍然可达'.repeat(4));
  const button = page.getByRole('button', { name: '核对入库信息', exact: true });
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
  await page.goto(`/items/${box}`);
  await page.getByRole('button', { name: '移动', exact: true }).click();
  await page.getByRole('combobox', { name: '目标位置' }).click();
  await page.getByText(`全部位置 / 书房 ${suffix}`, { exact: true }).click();
  await page.getByRole('button', { name: '确认移动 1 件', exact: true }).click();
  await expect(page.getByRole('dialog')).toHaveCount(0);
  await page.goto(`/items/${f.ids[0]}`);
  await expect(page.locator('main header')).toContainText(`书房 ${suffix} / 收纳箱 ${suffix}`);
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
  // Clothing fields belong to a wearable SKU; preserve editing of its existing v1 binding.
  const garment = await command(page, 'create_catalog_node', {
    kind: 'SKU',
    name: `衣物模板验收 ${crypto.randomUUID()}`,
    profile: 'WEARABLE',
    initial_attributes: [{ template_id: 'clothing', template_version: 1, values: {} }],
  });
  const garmentId = garment.affected_objects[0].id;
  await page.goto(`/catalog/${garmentId}?dialog=attributes&target=${garmentId}&template=clothing`);
  await page.getByLabel('材质', { exact: true }).fill('棉');
  await page.getByLabel('尺码', { exact: true }).fill('M');
  await page.getByRole('button', { name: '保存', exact: true }).click();
  await page.getByRole('button', { name: '仅批准本次', exact: true }).click();
  await expect(page.getByText('已批准本次变更，请提交保存。')).toBeVisible();
  await page.getByRole('button', { name: '保存', exact: true }).click();
  await expect(page.getByRole('dialog')).toHaveCount(0);
  const product = await fixtureRead(page, 'get_catalog_node', { catalog_node_id: garmentId });
  expect(product.attributes.find((a: any) => a.template_id === 'clothing').values).toMatchObject({
    material: '棉',
    size: 'M',
  });
  await page.goto(`/items/${f.ids[0]}`);
  await page.getByText('更多', { exact: true }).click();
  await page.getByRole('button', { name: '整件用完', exact: true }).click();
  await page.getByRole('button', { name: '确认整件用完', exact: true }).click();
  await expect(page.getByRole('dialog')).toHaveCount(0);
  await expect(page.getByText('0 mL', { exact: true }).first()).toBeVisible();
  await page.goto(`/items/${f.ids[0]}?dialog=correct&target=${f.ids[0]}&template=lifecycle`);
  await choose(page, '生命周期', '在库');
  await page.getByLabel('剩余内容', { exact: true }).fill('500');
  await page.getByLabel('纠错原因', { exact: true }).fill('误点用完，重新核对仍有 500 mL');
  await page.getByRole('button', { name: '保存', exact: true }).click();
  await expect(page.getByRole('dialog')).toHaveCount(0);
  await expect(page.getByText('500 mL', { exact: true }).first()).toBeVisible();
  await expect(page.locator('main')).toContainText('误点用完');
});
test('Ant Design pagination retains catalog, SKU and search return state', async ({ page }) => {
  const f = await fixture(page);
  await command(page, 'create_items', { catalog_node_id: f.sku, count: 54 });
  await page.setViewportSize({ width: 1440, height: 1000 });
  await page.goto('/catalog');
  await page.getByRole('searchbox', { name: '搜索商品', exact: true }).fill(f.name);
  await page.locator(`main a[href^="/catalog/${f.sku}?"]`).click();
  await page.getByRole('link', { name: '查看实物', exact: true }).click();
  const rows = page.locator('main a[href*="/items/item_"]');
  await expect(rows).toHaveCount(50);
  await page.getByRole('button', { name: '加载更多', exact: true }).click();
  await expect(rows).toHaveCount(60);
  await rows.last().click();
  await page.locator('main').getByRole('link', { name: '我的物品', exact: true }).click();
  await expect(rows).toHaveCount(60);
  await page.goto('/search');
  await page.getByRole('searchbox', { name: '搜索物品', exact: true }).fill(f.name);
  await expect(rows).toHaveCount(50);
  await page.getByRole('button', { name: '加载更多', exact: true }).click();
  await expect(rows).toHaveCount(60);
  for (const width of [360, 390, 768, 1024, 1440]) {
    await page.setViewportSize({ width, height: 900 });
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(
      true,
    );
    await page.screenshot({ path: `output/playwright/antd-search-${width}.png` });
  }
  const snapshot = await fixtureRead(page);
  const room = snapshot.items.find((i: any) => i.display_name === '验收储藏室');
  const kitchen = snapshot.items.find((i: any) => i.display_name === '验收厨房');
  await page.goto(`/search?q=验收牛奶&location=${room.id}`);
  await expect(rows).toHaveCount(6);
  await page.goto(`/search?q=验收牛奶&location=${kitchen.id}`);
  await expect(page.getByRole('heading', { name: '没有匹配的物品', exact: true })).toBeVisible();
});

test('Ant Design consumption validates inline and moving requires a separate path confirmation', async ({
  page,
}) => {
  const f = await fixture(page);
  await page.goto(`/items/${f.ids[0]}`);
  await page.getByRole('button', { name: '记录消耗', exact: true }).click();
  for (const value of ['0', '-1', '1001', 'Infinity', 'NaN']) {
    await page.getByLabel('本次消耗量', { exact: true }).fill(value);
    await expect(page.getByRole('button', { name: '确认记录消耗', exact: true })).toBeDisabled();
    await expect(
      page.locator('section[aria-live="polite"]').filter({ hasText: '使用后剩余' }),
    ).toContainText('填写消耗量后预览');
    await expect(page.getByLabel('本次消耗量', { exact: true })).toHaveAttribute(
      'aria-invalid',
      'true',
    );
  }
  await page.getByLabel('本次消耗量', { exact: true }).fill('200');
  await expect(
    page.locator('section[aria-live="polite"]').filter({ hasText: '使用后剩余' }),
  ).toContainText('800 mL');
  for (const width of [390, 1280]) {
    await page.setViewportSize({ width, height: 900 });
    await page.screenshot({ path: `output/playwright/soft-consume-${width}.png`, fullPage: true });
  }
  await page.getByRole('button', { name: '取消', exact: true }).click();
  await page.getByRole('button', { name: '保留草稿并关闭', exact: true }).click();
  await page.setViewportSize({ width: 390, height: 844 });
  await page.getByRole('button', { name: '移动', exact: true }).click();
  await expect(page.getByRole('button', { name: '确认移动 1 件' })).toBeDisabled();
  await page.getByRole('combobox', { name: '目标位置', exact: true }).click();
  await page.getByText('全部位置 / 验收厨房', { exact: true }).click();
  let writes = 0;
  page.on('request', (request) => {
    if (request.url().includes('/api/write/move_item')) writes++;
  });
  await expect(
    page.locator('section[aria-live="polite"]').filter({ hasText: '确认移至' }),
  ).toContainText('全部位置 / 验收厨房');
  expect(writes).toBe(0);
  await page.screenshot({ path: 'output/playwright/workbench-move-confirm-390.png' });
  await page.getByRole('button', { name: '确认移动 1 件', exact: true }).click();
  await expect(page.getByRole('dialog')).toHaveCount(0);
  expect(writes).toBe(1);
  await expect(page.locator('main header')).toContainText('验收厨房');
  await page.getByRole('button', { name: '移动', exact: true }).click();
  await expect(page.getByRole('button', { name: '确认移动 1 件' })).toBeDisabled();
});

test.describe('Ant Design committed write recovery', () => {
  test.use({ serviceWorkers: 'block' });
  test('a successful write with failed refresh can reread without another write', async ({
    page,
  }) => {
    const f = await fixture(page);
    await page.goto(`/items/${f.ids[0]}`);
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
    await expect(page.getByText('850 mL', { exact: true }).first()).toBeVisible();
  });
});

test('session expiry preserves the exact pending edit and logout clears private caches', async ({
  page,
}) => {
  test.skip(!process.env.ACORNARY_E2E_CLOUD, 'Secure session boundary');
  const f = await fixture(page);
  await page.goto(`/items/${f.ids[0]}`);
  await page.getByRole('button', { name: '记录消耗', exact: true }).click();
  await page.getByLabel('本次消耗量').fill('175');
  await page.request.post('/api/auth/sign-out', {
    headers: { Origin: new URL(page.url()).origin },
    data: {},
  });
  await page.getByRole('button', { name: '确认记录消耗', exact: true }).click();
  const loginDialog = page.getByRole('dialog', { name: '重新登录', exact: true });
  await expect(loginDialog).toBeVisible();
  await login(page);
  await expect(loginDialog).toHaveCount(0);
  await expect(page.getByLabel('本次消耗量')).toHaveValue('175');
  await page.getByRole('button', { name: '重试同一次操作' }).click();
  await expect(page.getByRole('dialog')).toHaveCount(0);
  await expect(page.getByText('825 mL', { exact: true }).first()).toBeVisible();
  await page.goto('/settings');
  await page.getByRole('button', { name: '退出登录', exact: true }).click();
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
