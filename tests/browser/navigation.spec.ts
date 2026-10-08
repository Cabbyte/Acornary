import { test, expect, type Page } from '@playwright/test';
import { login } from './login.js';

test('Ant Design split actions align and desktop icon navigation remembers its state', async ({
  page,
}) => {
  await page.goto('/items');
  await login(page);
  await expect(page.getByRole('heading', { name: '我的物品', exact: true })).toBeVisible();
  const sidebar = page.locator('.wb-sidebar');
  const mainNavigation = page.getByRole('menu', { name: '主导航', exact: true });
  const settings = page.getByRole('menu', { name: '设置导航' });
  await page.getByRole('button', { name: '收起侧栏', exact: true }).focus();
  await page.keyboard.press('Enter');
  await expect(page.getByRole('button', { name: '展开侧栏' })).toHaveAttribute(
    'aria-expanded',
    'false',
  );
  await expect.poll(async () => (await sidebar.boundingBox())!.width).toBeCloseTo(64, 0);
  await mainNavigation.getByRole('menuitem', { name: '商品目录', exact: true }).hover();
  await expect(page.getByRole('tooltip', { name: '商品目录', exact: true })).toBeVisible();
  await mainNavigation.getByRole('menuitem', { name: '商品目录', exact: true }).click();
  await expect(page).toHaveURL(/\/catalog$/);
  await settings.getByRole('menuitem', { name: '设置', exact: true }).click();
  await expect(page.getByRole('heading', { name: '设置', exact: true })).toBeVisible();
  await page.reload();
  await expect.poll(async () => (await sidebar.boundingBox())!.width).toBeCloseTo(64, 0);
  expect((await settings.boundingBox())!.y).toBeGreaterThan(850);
  await page.screenshot({ path: 'output/playwright/sidebar-icons-settings.png' });
  for (const width of [1024, 390, 1920]) {
    await page.setViewportSize({ width, height: 1000 });
    if (width < 768) await expect(page.getByRole('navigation', { name: '底部导航' })).toBeVisible();
    else await expect.poll(async () => (await sidebar.boundingBox())!.width).toBeCloseTo(64, 0);
  }
  await page.getByRole('button', { name: '展开侧栏', exact: true }).click();
  await expect.poll(async () => (await sidebar.boundingBox())!.width).toBeCloseTo(224, 0);
  await mainNavigation.getByRole('menuitem', { name: '我的物品', exact: true }).click();
  for (const width of [1440, 1024, 390, 360]) {
    await page.setViewportSize({ width, height: 1000 });
    const add = page.getByRole('button', { name: '添加物品', exact: true });
    const more = page.getByRole('button', { name: '更多添加选项', exact: true });
    await expect
      .poll(async () => {
        const a = (await add.boundingBox())!,
          b = (await more.boundingBox())!;
        return Math.max(Math.abs(a.y - b.y), Math.abs(a.height - b.height));
      })
      .toBeLessThan(1);
    await more.click();
    await expect(page.getByRole('menuitem', { name: '添加位置', exact: true })).toBeVisible();
    await page.screenshot({ path: `output/playwright/add-actions-aligned-${width}.png` });
    await page.keyboard.press('Escape');
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
  const write = async (name: string, input: object) => {
    const r = await page.request.post(`/api/write/${name}`, {
      headers,
      data: { idempotency_key: crypto.randomUUID(), ...input },
    });
    expect(r.status(), await r.text()).toBe(200);
    return (await r.json()).affected_objects;
  };
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

test('Ant Design in-page location tree resizing, scope, creation and responsive state', async ({
  page,
  browserName,
}) => {
  const errors: string[] = [];
  page.on('pageerror', (error) => errors.push(error.message));
  await page.goto('/items');
  await login(page);
  await expect(page.getByRole('heading', { name: '我的物品', exact: true })).toBeVisible();
  const f = await fixture(page);
  await page.goto(`/places/${f.room}`);
  await expect(page.getByRole('checkbox', { name: '包含下级位置' })).toBeChecked();
  const rows = page.getByRole('table', { name: '物品列表' }).getByRole('row');
  await expect(rows).toHaveCount(9);
  await page.getByRole('checkbox', { name: '包含下级位置' }).uncheck();
  await expect(page.getByRole('table', { name: '物品列表' })).not.toContainText('布局牛奶');
  await page.getByRole('checkbox', { name: '包含下级位置' }).check();
  await expect(rows).toHaveCount(9);
  const navigation = page.getByRole('menu', { name: '主导航', exact: true });
  await expect(navigation.getByRole('menuitem')).toHaveCount(2);
  await expect(navigation).not.toContainText('位置');
  await expect(navigation).not.toContainText('设置');
  const settings = page.getByRole('menu', { name: '设置导航' });
  expect((await settings.boundingBox())!.y).toBeGreaterThan(850);
  const separator = page.getByRole('separator', { name: '调整位置栏宽度' });
  await expect(separator).toHaveAttribute('aria-valuenow', '224');
  await expect
    .poll(async () => (await page.locator('.wb-location-panel').boundingBox())!.width)
    .toBeCloseTo(224, 0);
  await separator.focus();
  await page.keyboard.press('ArrowRight');
  await expect(separator).toHaveAttribute('aria-valuenow', '232');
  await page.keyboard.press('End');
  await expect(separator).toHaveAttribute('aria-valuenow', '320');
  await page.reload();
  await expect(separator).toHaveAttribute('aria-valuenow', '320');
  await separator.focus();
  await page.keyboard.press('Home');
  await expect(separator).toHaveAttribute('aria-valuenow', '180');
  const grip = (await separator.boundingBox())!;
  await page.mouse.move(grip.x + grip.width / 2, grip.y + 80);
  await page.mouse.down();
  await page.mouse.move(grip.x + 800, grip.y + 80, { steps: 6 });
  await page.mouse.up();
  await expect(separator).toHaveAttribute('aria-valuenow', '320');
  if (browserName === 'chromium') {
    const touch = await page.context().newCDPSession(page);
    const box = (await separator.boundingBox())!;
    const point = { x: box.x + box.width / 2, y: box.y + 80 };
    await touch.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [point] });
    await touch.send('Input.dispatchTouchEvent', {
      type: 'touchMove',
      touchPoints: [{ x: point.x - 64, y: point.y }],
    });
    await touch.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] });
    await expect(separator).toHaveAttribute('aria-valuenow', '256');
    await touch.detach();
  }
  await separator.dblclick({ position: { x: 1, y: 80 } });
  await expect(separator).toHaveAttribute('aria-valuenow', '224');
  expect((await page.locator('.wb-list-panel').boundingBox())!.width - 16).toBeGreaterThanOrEqual(
    640,
  );

  await page.getByRole('searchbox', { name: '搜索位置', exact: true }).fill(f.roomName);
  await page.setViewportSize({ width: 1024, height: 900 });
  await expect(separator).toBeHidden();
  await page.getByRole('button', { name: '收起侧栏', exact: true }).click();
  await expect
    .poll(async () => (await page.locator('.wb-sidebar').boundingBox())!.width)
    .toBeCloseTo(64, 0);
  await page.getByRole('button', { name: '展开侧栏', exact: true }).click();
  await expect
    .poll(async () => (await page.locator('.wb-sidebar').boundingBox())!.width)
    .toBeCloseTo(200, 0);

  await page.getByRole('button', { name: '位置', exact: true }).click();
  await expect(page.getByRole('dialog', { name: '选择位置' }).getByRole('searchbox')).toHaveValue(
    f.roomName,
  );
  await page.getByRole('searchbox', { name: '搜索位置', exact: true }).fill('');
  await expect(
    page.getByRole('tree', { name: '位置树' }).getByText(f.fridgeName, { exact: true }),
  ).toBeVisible();
  await page.keyboard.press('Escape');
  await expect(page.getByRole('button', { name: '位置', exact: true })).toBeFocused();
  await page.setViewportSize({ width: 1440, height: 1000 });
  await expect(separator).toHaveAttribute('aria-valuenow', '224');
  await expect(page.getByRole('searchbox', { name: '搜索位置', exact: true })).toHaveValue('');

  await page.getByRole('button', { name: '添加物品', exact: true }).click();
  expect(new URL(page.url()).searchParams.get('parent')).toBe(f.room);
  await expect(
    page.getByRole('dialog', { name: '入库', exact: true }).getByTitle(f.roomName, { exact: true }),
  ).toBeVisible();
  await page.getByRole('button', { name: '取消', exact: true }).click();
  await page.getByRole('button', { name: '更多添加选项' }).click();
  await page.getByRole('menuitem', { name: '添加位置', exact: true }).click();
  const editor = page.getByRole('dialog', { name: '新建位置', exact: true });
  await expect(editor.getByTitle(f.roomName, { exact: true })).toBeVisible();
  await editor.getByLabel('名称', { exact: true }).fill('调整尺寸保留的新位置');
  for (const width of [360, 390, 768, 1024, 1200, 1440, 1920]) {
    await page.setViewportSize({ width, height: 1000 });
    await expect(editor.getByLabel('名称', { exact: true })).toHaveValue('调整尺寸保留的新位置');
    await expect
      .poll(() => page.evaluate(() => document.documentElement.scrollWidth <= innerWidth))
      .toBe(true);
  }
  const saved = page.waitForRequest((r) => r.url().includes('/api/write/create_items'));
  await editor.getByRole('button', { name: '保存', exact: true }).click();
  expect((await saved).postDataJSON().parent_id).toBe(f.room);
  await expect(editor).toHaveCount(0);
  await page.getByRole('button', { name: '位置操作', exact: true }).click();
  await page.getByRole('menuitem', { name: '修改位置名称', exact: true }).click();
  await page
    .getByRole('dialog', { name: '修改名称', exact: true })
    .getByLabel('名称', { exact: true })
    .fill('新位置已核对');
  await page.getByRole('button', { name: '保存', exact: true }).click();
  await expect(page.getByRole('dialog', { name: '修改名称', exact: true })).toHaveCount(0);
  await expect(page.getByRole('navigation', { name: '完整位置路径' })).toContainText(
    '新位置已核对',
  );

  await page
    .getByRole('navigation', { name: '完整位置路径' })
    .getByRole('link', { name: f.roomName, exact: true })
    .click();

  await page
    .getByRole('button', { name: new RegExp(`^布局牛奶`) })
    .first()
    .click();
  await expect(page.locator('.wb-inspector')).toBeVisible();
  await page.setViewportSize({ width: 1440, height: 1000 });
  await expect(page.getByRole('dialog', { name: '物品详情', exact: true })).toBeVisible();
  await page.getByRole('button', { name: '返回列表', exact: true }).click();
  for (const width of [360, 390, 768, 1024, 1200, 1440, 1920]) {
    await page.setViewportSize({ width, height: 1000 });
    await expect
      .poll(() => page.evaluate(() => document.documentElement.scrollWidth <= innerWidth))
      .toBe(true);
    if (width >= 1200) {
      await expect(separator).toBeVisible();
      await expect
        .poll(async () => (await page.locator('.wb-location-panel').boundingBox())!.width)
        .toBeCloseTo(224, 0);
      await expect
        .poll(async () => (await page.locator('.wb-sidebar').boundingBox())!.width)
        .toBeCloseTo(224, 0);
    } else await expect(page.getByRole('button', { name: '位置', exact: true })).toBeVisible();
    await page.screenshot({
      animations: 'disabled',
      path: `output/playwright/navigation-${width}-${process.env.ACORNARY_E2E_BROWSER ?? 'chromium'}.png`,
    });
  }
  await page.getByRole('button', { name: '全部物品', exact: true }).click();
  await expect(page).toHaveURL(/\/items$/);
  await page.getByRole('button', { name: '更多添加选项' }).click();
  await page.getByRole('menuitem', { name: '添加位置', exact: true }).click();
  await expect(page.getByRole('dialog').getByTitle('暂不指定位置')).toBeVisible();
  expect(errors).toEqual([]);
});
