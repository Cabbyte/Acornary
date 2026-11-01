import { test, expect } from './legacy.js';
import { login } from './login.js';
import { fixtureCommand, fixtureRead } from './governance.js';

test('UUID selection survives search and operation history preserves each item', async ({
  page,
}) => {
  await page.goto('/items');
  await login(page);
  await expect(page.getByRole('heading', { name: '我的物品', exact: true })).toBeVisible();
  const name = `分组验收 ${crypto.randomUUID().slice(0, 6)}`;
  const sku = (await fixtureCommand(page, 'create_catalog_node', { kind: 'SKU', name }))
    .affected_objects[0].id;
  const receipt = await fixtureCommand(page, 'create_items', { catalog_node_id: sku, count: 25 });
  await page.reload();
  const search = page.getByRole('searchbox', { name: '搜索物品', exact: true });
  await search.fill(name);
  await page.getByRole('button', { name: '选择', exact: true }).click();
  await expect(page.getByRole('checkbox', { name: `选择 ${name}`, exact: true })).toHaveCount(25);
  await page.getByRole('checkbox', { name: '选择当前已加载物品', exact: true }).check();
  await expect(page.getByText('已选 25 件', { exact: true })).toBeVisible();
  await search.fill('没有这种物品');
  await expect(page.getByRole('heading', { name: '没有匹配的物品', exact: true })).toBeVisible();
  await expect(page.getByText('已选 25 件', { exact: true })).toBeVisible();
  await search.fill(name);
  await expect(page.locator('main input[type="checkbox"]:checked')).toHaveCount(26);
  await page.locator('main a[href*="/items/item_"]').first().click();
  await expect(page.getByRole('button', { name: '记录消耗', exact: true })).toBeDisabled();
  await page.getByText('更多', { exact: true }).click();
  await expect(page.getByRole('button', { name: '整件用完', exact: true })).toBeEnabled();
  await page.goto('/activity');
  await expect(page.getByRole('heading', { name: '动态', exact: true })).toBeVisible();
  await expect(page.locator('main li').filter({ hasText: name })).toHaveCount(26);
  const history = await fixtureRead(page, 'get_history', { limit: 100 });
  expect(
    new Set(
      history.data
        .filter((e: any) => e.operation_id === receipt.operation_id)
        .map((e: any) => e.target_id),
    ),
  ).toEqual(new Set(receipt.affected_objects.map((o: any) => o.id)));
});

test('stash visual inventory, expanded instances and mobile dossier remain usable', async ({
  page,
}) => {
  await page.goto('/items');
  await login(page);
  await expect(page.getByRole('heading', { name: '我的物品', exact: true })).toBeVisible();
  const household = await page.evaluate(() => sessionStorage.getItem('acornary-household') ?? '');
  const snapshot = await (
    await page.request.get('/api/ui/snapshot', { headers: { 'X-Acornary-Household': household } })
  ).json();
  const write = async (op: string, input: object) =>
    (await fixtureCommand(page, op, input)).affected_objects;
  const root = (
    await write('create_items', {
      catalog_node_id: snapshot.container_catalog_id,
      count: 1,
      display_name: '日常收纳',
      initial_attributes: [
        { template_id: 'container', template_version: 1, values: { can_contain: true } },
      ],
    })
  )[0].id;
  const shelf = (
    await write('create_items', {
      catalog_node_id: snapshot.container_catalog_id,
      count: 1,
      parent_id: root,
      display_name: '厨房 · 冷藏上层',
      initial_attributes: [
        { template_id: 'container', template_version: 1, values: { can_contain: true } },
      ],
    })
  )[0].id;
  const names = [
    '光明全脂牛奶 1L',
    'Makita 充电式电钻 DDF484 · 18V',
    '亚麻衬衫 · 雾蓝色 M',
    '燕麦片 500g',
    '挂耳咖啡 · 哥伦比亚水洗',
    'USB-C 编织线 2m',
  ];
  let milk = '';
  for (const [index, name] of names.entries()) {
    const sku = (await write('create_catalog_node', { kind: 'SKU', name }))[0].id;
    const created = await write('create_items', {
      catalog_node_id: sku,
      count: index === 0 ? 6 : index === 1 ? 1 : 2,
      parent_id: index === 0 ? shelf : root,
    });
    if (index === 0) milk = created[0].id;
  }
  await page.goto(`/places/${root}`);
  await expect(page.locator('main a[href*="/items/item_"]')).toHaveCount(15);
  for (const width of [360, 390, 768, 1024, 1440, 1920]) {
    await page.setViewportSize({ width, height: 900 });
    await expect
      .poll(() => page.evaluate(() => document.documentElement.scrollWidth <= innerWidth))
      .toBe(true);
    await page.screenshot({
      path: `output/playwright/stash-overview-${width}.png`,
      fullPage: true,
      animations: 'disabled',
    });
  }
  const rows = page.locator('main a[href*="/items/item_"]').filter({ hasText: '' });
  const row = page.locator(`main a[href^="/items/${milk}?"]`);
  for (const width of [390, 1920]) {
    await page.setViewportSize({ width, height: 900 });
    await row.focus();
    await row.press('Enter');
    await expect(page.getByRole('heading', { name: names[0], exact: true })).toBeVisible();
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(
      true,
    );
    await page.screenshot({ path: `output/playwright/stash-detail-${width}.png` });
    await page.locator('main').getByRole('link', { name: '我的物品', exact: true }).click();
    await expect(rows).toHaveCount(15);
  }
});
