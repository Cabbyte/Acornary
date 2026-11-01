import { fixtureCommand } from './governance.js';
import { test, expect, type Page } from './legacy.js';
import { login } from './login.js';
import { catalogFixture, checkCatalog } from './catalog-checks.js';

test('Ant Design catalog tree filters and preserves browse state on Web', async ({ page }) => {
  await page.goto('/items');
  await login(page);
  await expect(page.getByRole('heading', { name: '我的物品', exact: true })).toBeVisible();
  const f = await catalogFixture((name, input) => fixtureCommand(page, name, input));
  await page.goto('/catalog');
  await checkCatalog(page, page, f, 'web');
});

test('Ant Design responsive navigation keeps the active route and reachable actions', async ({
  page,
}) => {
  await page.goto('/items');
  await login(page);
  for (const width of [1440, 1024, 390, 360, 1920]) {
    await page.setViewportSize({ width, height: 1000 });
    const nav =
      width < 768
        ? page.getByRole('navigation', { name: '底部导航' })
        : page.getByRole('complementary', { name: '主导航' });
    for (const name of ['商品目录', '动态', '设置', '我的物品']) {
      await nav.getByRole('link', { name, exact: true }).click();
      await expect(page.getByRole('heading', { name, exact: true })).toBeVisible();
      await expect(nav.getByRole('link', { name, exact: true })).toHaveAttribute(
        'aria-current',
        'page',
      );
    }
    await page.getByRole('button', { name: '添加物品', exact: true }).click();
    await expect(page.getByRole('dialog', { name: '入库', exact: true })).toBeVisible();
    await page.keyboard.press('Escape');
    await expect(page.getByRole('button', { name: '添加物品', exact: true })).toBeFocused();
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(
      true,
    );
  }
});

async function fixture(page: Page) {
  const household = await page.evaluate(() => sessionStorage.getItem('acornary-household') ?? '');
  const headers = {
    Origin: new URL(page.url()).origin,
    'X-Acornary-Request': 'web',
    'X-Acornary-Household': household,
  };
  const snapshot = await (await page.request.get('/api/ui/snapshot', { headers })).json();
  const write = async (name: string, input: object) =>
    (await fixtureCommand(page, name, input)).affected_objects;
  const suffix = crypto.randomUUID().slice(0, 6);
  const roomName = `布局厨房 ${suffix}`;
  const room = (
    await write('create_items', {
      catalog_node_id: snapshot.container_catalog_id,
      count: 1,
      display_name: roomName,
      initial_attributes: [
        { template_id: 'container', template_version: 1, values: { can_contain: true } },
      ],
    })
  )[0].id;
  const fridgeName = `冰箱与需要完整路径查看的超长收纳位置 ${suffix}`;
  const fridge = (
    await write('create_items', {
      catalog_node_id: snapshot.container_catalog_id,
      count: 1,
      display_name: fridgeName,
      parent_id: room,
      initial_attributes: [
        { template_id: 'container', template_version: 1, values: { can_contain: true } },
      ],
    })
  )[0].id;
  const sku = (await write('create_catalog_node', { kind: 'SKU', name: `布局牛奶 ${suffix}` }))[0]
    .id;
  const items = await write('create_items', { catalog_node_id: sku, count: 8, parent_id: fridge });
  return { room, roomName, fridge, fridgeName, item: items[0].id };
}

test('Ant Design location scopes include descendants and preserve search on detail return', async ({
  page,
}) => {
  const errors: string[] = [];
  page.on('pageerror', (error) => errors.push(error.message));
  await page.goto('/items');
  await login(page);
  await expect(page.getByRole('heading', { name: '我的物品', exact: true })).toBeVisible();
  const f = await fixture(page);
  await page.goto(`/places/${f.room}`);
  const rows = page.locator('main a[href*="/items/item_"]');
  await expect(rows).toHaveCount(8);
  await page.getByRole('searchbox', { name: '搜索物品', exact: true }).fill('布局牛奶');
  for (const width of [1440, 1024, 390, 360]) {
    await page.setViewportSize({ width, height: 900 });
    await expect(rows).toHaveCount(8);
    await rows.first().click();
    await expect(page.locator('main header')).toContainText(f.fridgeName);
    await page.locator('main').getByRole('link', { name: '我的物品', exact: true }).click();
    await expect(page).toHaveURL(new RegExp(`/places/${f.room}`));
    await expect(page.getByRole('searchbox', { name: '搜索物品', exact: true })).toHaveValue(
      '布局牛奶',
    );
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(
      true,
    );
  }
  await page.getByRole('button', { name: '位置', exact: true }).click();
  await page
    .getByRole('menuitem', { name: `${f.roomName} / ${f.fridgeName}`, exact: true })
    .click();
  await expect(page).toHaveURL(new RegExp(`/places/${f.fridge}`));
  await expect(rows).toHaveCount(8);
  expect(errors).toEqual([]);
});
