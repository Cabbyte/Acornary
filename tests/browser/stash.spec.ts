import { test, expect } from '@playwright/test';
import { login } from './login.js';
import { choose } from './controls.js';
import { fixtureCommand } from './governance.js';
test('stash groups preserve UUID selection, scope, consumption choice and operation history', async ({
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
  await page.getByRole('searchbox', { name: '搜索物品、规格、位置…' }).fill(name);
  await expect(page.locator('.stash-group')).toHaveCount(1);
  await expect(page.locator('.stash-instance')).toHaveCount(20);
  await page.getByRole('checkbox', { name: '选择本页全部物品' }).check();
  await expect(page.getByText('已选 20 件', { exact: true })).toBeVisible();
  await page.getByTitle('2', { exact: true }).click();
  await expect(page.locator('.stash-instance')).toHaveCount(5);
  await page.getByRole('checkbox', { name: '选择本页全部物品' }).check();
  await expect(page.getByText('已选 25 件', { exact: true })).toBeVisible();
  await choose(page, '分组方式', '按位置');
  await expect(page.getByText('已选 25 件', { exact: true })).toBeVisible();
  await page.getByRole('searchbox', { name: '搜索物品、规格、位置…' }).fill('没有这种物品');
  await expect(page.getByText('已选 25 件，其中 25 件不在当前结果', { exact: true })).toBeVisible();
  await page.getByRole('button', { name: '查看已选', exact: true }).click();
  await expect(page.locator('.stash-instance')).toHaveCount(20);
  await page.locator('.stash-item-open').filter({ hasText: name }).first().click();
  await page.getByRole('button', { name: '记录消耗', exact: true }).click();
  await expect(page.getByRole('button', { name: '记录余量', exact: true })).toBeVisible();
  await expect(page.getByRole('button', { name: '整件用完', exact: true })).toBeVisible();
  await page.getByRole('button', { name: '记录余量', exact: true }).click();
  await expect(page.getByRole('dialog').last()).toContainText('剩余');
  await page.goto('/activity');
  await expect(page.getByRole('heading', { name: '动态', exact: true })).toBeVisible();
  const operation = page.locator('.stash-activity .ant-collapse-header').first();
  await operation.click();
  await expect(page.locator('.stash-activity article')).toHaveCount(25);
  const links = await page
    .locator('.stash-activity article a')
    .evaluateAll((nodes) => nodes.map((n) => n.getAttribute('href')));
  expect(new Set(links)).toEqual(
    new Set(receipt.affected_objects.map((o: any) => `/items/${o.id}`)),
  );
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
  await expect(page.locator('.stash-group')).toHaveCount(6);
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
  await page.locator('.stash-group-toggle').filter({ hasText: names[0] }).click();
  await expect(page.locator('.stash-instance').filter({ hasText: names[0] })).toHaveCount(6);
  await page.screenshot({
    path: 'output/playwright/stash-expanded-1920.png',
    fullPage: true,
    animations: 'disabled',
  });
  await page.locator('.stash-item-open').filter({ hasText: names[0] }).first().click();
  await expect(page.getByRole('heading', { name: names[0], exact: true })).toBeFocused();
  await page.screenshot({
    path: 'output/playwright/stash-dossier-1920.png',
    fullPage: true,
    animations: 'disabled',
  });
  await page.setViewportSize({ width: 390, height: 900 });
  await expect(page.getByRole('heading', { name: names[0], exact: true })).toBeFocused();
  await expect
    .poll(() => page.evaluate(() => document.documentElement.scrollWidth <= innerWidth))
    .toBe(true);
  await page.screenshot({
    path: 'output/playwright/stash-dossier-390.png',
    fullPage: true,
    animations: 'disabled',
  });
  await page.getByRole('button', { name: '返回列表', exact: true }).click();
  await expect(page.locator('.stash-instance').filter({ hasText: names[0] })).toHaveCount(6);
  await expect(
    page.locator('.stash-item-open').filter({ hasText: names[0] }).first(),
  ).toBeFocused();
  for (const width of [390, 1920]) {
    await page.setViewportSize({ width, height: 900 });
    const row = page.locator('.stash-item-open').filter({ hasText: names[0] }).first();
    await row.focus();
    await row.press('Enter');
    await expect(page.locator('#stash-dossier-heading')).toBeFocused();
    await page.getByRole('button', { name: '返回列表', exact: true }).click();
    await expect(row).toBeFocused();
  }
});
