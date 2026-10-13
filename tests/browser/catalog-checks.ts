import { expect, type FrameLocator, type Page } from '@playwright/test';

export async function catalogFixture(command: (name: string, input: any) => Promise<any>) {
  const suffix = crypto.randomUUID().slice(0, 6);
  const create = async (
    kind: string,
    name: string,
    parent_id: string | null = null,
    initial_attributes: any[] = [],
  ) =>
    (await command('create_catalog_node', { kind, name, parent_id, initial_attributes }))
      .affected_objects[0].id as string;
  const first = `分类验收甲 ${suffix}`,
    second = `分类验收乙 ${suffix}`;
  const child = `同名子类 ${suffix}`,
    leaf = `细类 ${suffix}`,
    empty = `空分类 ${suffix}`;
  const a = await create('GROUP', first),
    b = await create('GROUP', second);
  const branch = await create('GROUP', child, a);
  await create('GROUP', child, b);
  const deep = await create('GROUP', leaf, branch);
  await create('GROUP', empty, a);
  const names: string[] = [];
  for (let n = 0; n < 22; n++) {
    const name = `树状商品 ${suffix} ${String(n).padStart(2, '0')}`;
    names.push(name);
    const id = await create('SKU', name, deep);
    if (!n) await command('create_items', { catalog_node_id: id, count: 3 });
  }
  const hidden = `隐藏商品 ${suffix}`;
  await create('SKU', hidden, deep, [
    { template_id: 'catalog', template_version: 1, values: { visibility: 'HIDDEN' } },
  ]);
  const root = `根商品 ${suffix}`;
  await create('SKU', root);
  return { first, second, child, leaf, empty, names, hidden, root };
}

export async function checkCatalog(
  page: Page,
  ui: Page | FrameLocator,
  f: Awaited<ReturnType<typeof catalogFixture>>,
  surface: string,
) {
  const tree = ui.getByRole('tree', { name: '商品分类树' });
  const query = ui.getByRole('searchbox', { name: '搜索分类', exact: true });
  const products = ui.getByRole('table', { name: '商品列表' });
  const productQuery = ui.getByRole('searchbox', { name: '搜索商品名称或规格' });
  const separator = ui.getByRole('separator', { name: '调整分类栏宽度' });
  const path = `${f.first} / ${f.child} / ${f.leaf}`;
  await expect(separator).toHaveAttribute('aria-valuenow', '224');
  await separator.focus();
  await separator.press('End');
  await expect(separator).toHaveAttribute('aria-valuenow', '320');
  await separator.press('Home');
  await expect(separator).toHaveAttribute('aria-valuenow', '180');
  const grip = (await separator.boundingBox())!;
  await page.mouse.move(grip.x + grip.width / 2, grip.y + 80);
  await page.mouse.down();
  await page.mouse.move(grip.x + 800, grip.y + 80, { steps: 6 });
  await page.mouse.up();
  await expect(separator).toHaveAttribute('aria-valuenow', '320');
  await query.fill(f.child);
  await expect(tree.getByTitle(`${f.first} / ${f.child}`, { exact: true })).toBeVisible();
  await expect(tree.getByTitle(`${f.second} / ${f.child}`, { exact: true })).toBeVisible();
  await tree.getByTitle(path, { exact: true }).click();
  await expect(ui.getByLabel('当前商品分类')).toHaveText(path);
  await expect(products.getByRole('row')).toHaveCount(21);
  await expect(tree.getByTitle(path, { exact: true })).toHaveText(`${path}22`);
  await expect(products).not.toContainText(f.hidden);
  await productQuery.fill(f.names[0]);
  await expect(products.getByRole('row')).toHaveCount(2);
  await expect(tree.getByTitle(path, { exact: true })).toHaveText(`${path}22`);
  await expect(products).toContainText('3 件实物');
  await productQuery.fill('');
  await query.fill('');
  await expect(tree.getByText(f.leaf, { exact: true })).toBeVisible();
  await ui.locator('.ant-pagination-next').click();
  await expect(products.getByRole('row')).toHaveCount(3);
  await products.getByRole('link', { name: f.names[20], exact: true }).click();
  await expect(
    ui.getByRole('table', { name: '实物列表' }).getByRole('columnheader', { name: '收纳位置' }),
  ).toHaveCount(0);
  await ui.getByRole('button', { name: '显示列', exact: true }).click();
  await expect(ui.getByRole('checkbox', { name: '收纳位置', exact: true })).toHaveCount(0);
  await ui.getByRole('button', { name: '显示列', exact: true }).click();
  await ui.getByRole('link', { name: '返回', exact: true }).click();
  await expect(products.getByRole('row')).toHaveCount(3);
  await expect(ui.getByLabel('当前商品分类')).toHaveText(path);
  await expect(tree.getByText(f.leaf, { exact: true })).toBeVisible();
  await expect(separator).toHaveAttribute('aria-valuenow', '320');
  await query.fill(f.empty);
  await tree.getByTitle(`${f.first} / ${f.empty}`, { exact: true }).click();
  await expect(products).toContainText('此分类下还没有商品');
  await query.fill(f.first);
  await tree.getByTitle(f.first, { exact: true }).click();
  await expect(products.getByRole('row')).toHaveCount(21);
  await expect(ui.locator('.ant-pagination-item-active')).toHaveText('1');
  await query.fill(f.leaf);
  await page.screenshot({
    path: `output/playwright/catalog-${surface}-desktop.png`,
    animations: 'disabled',
  });
  for (const width of [1024, 390, 360]) {
    await page.setViewportSize({ width, height: 1000 });
    const trigger = ui.getByRole('button', { name: '分类', exact: true });
    await trigger.click();
    await expect(query).toHaveValue(f.leaf);
    await expect(tree.getByTitle(path, { exact: true })).toBeVisible();
    await tree.getByTitle(path, { exact: true }).click();
    await expect(ui.getByRole('dialog', { name: '选择分类' })).toHaveCount(0);
    await expect(ui.getByLabel('当前商品分类')).toHaveText(path);
    expect(
      await ui.locator('body').evaluate(() => document.documentElement.scrollWidth <= innerWidth),
    ).toBe(true);
  }
  await page.screenshot({
    path: `output/playwright/catalog-${surface}-mobile.png`,
    animations: 'disabled',
  });
  await page.setViewportSize({ width: 1440, height: 1000 });
  await expect(query).toHaveValue(f.leaf);
  await expect(separator).toHaveAttribute('aria-valuenow', '320');
  await ui.getByRole('button', { name: '未分类', exact: true }).click();
  await productQuery.fill(f.root);
  await expect(products.getByRole('link', { name: f.root, exact: true })).toBeVisible();
  await expect(products.getByRole('row')).toHaveCount(2);
  await ui.getByRole('button', { name: '全部商品', exact: true }).click();
  await expect(ui.getByLabel('当前商品分类')).toHaveText('全部商品');
}
