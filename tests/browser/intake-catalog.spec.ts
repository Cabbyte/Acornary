import { expect, test, type Page } from '@playwright/test';
import { choose } from './controls.js';
import { fixtureCommand, fixtureRead } from './governance.js';
import { login } from './login.js';

async function start(page: Page) {
  await page.goto('/catalog?ui=next');
  if (process.env.ACORNARY_E2E_CLOUD) {
    await login(page);
    await page.goto('/catalog?ui=next');
  }
  await expect(page.getByRole('heading', { name: '商品目录', exact: true })).toBeVisible();
}

async function confirmCatalog(page: Page) {
  await page.getByRole('button', { name: '保存', exact: true }).click();
  await page.getByRole('button', { name: '仅批准本次', exact: true }).click();
  await expect(page.getByText('已批准本次变更，请提交保存。', { exact: true })).toBeVisible();
  await page.getByRole('button', { name: '保存', exact: true }).click();
  await expect(page.getByRole('dialog')).toHaveCount(0);
}

test('a categorized product created in the UI can be stocked and consumed without using its category as a location', async ({
  page,
}) => {
  await start(page);
  const before = await fixtureRead(page);
  const categoryName = `耗材分类 ${crypto.randomUUID()}`;
  const category = (
    await fixtureCommand(page, 'create_catalog_node', {
      kind: 'GROUP',
      name: categoryName,
    })
  ).affected_objects[0].id;
  await page.reload();
  await page.getByRole('button', { name: '新增商品', exact: true }).first().click();
  const productName = `验收耗材 ${crypto.randomUUID()}`;
  await page.getByLabel('名称', { exact: true }).fill(productName);
  await page.getByRole('combobox', { name: '所属分类', exact: true }).click();
  await page.getByRole('treeitem', { name: categoryName, exact: true }).click();
  await choose(page, '商品类型', '消耗品（食品、日用耗材）');
  await confirmCatalog(page);
  const snapshot = await fixtureRead(page);
  const product = snapshot.catalog.find((node: any) => node.name === productName);
  expect(product).toMatchObject({ parent_id: category, profile: 'CONSUMABLE' });
  expect(snapshot.items).toHaveLength(before.items.length);

  await page.getByRole('button', { name: '新增实物', exact: true }).click();
  await expect(page.getByRole('dialog')).toContainText('未指定位置');
  await expect(page.getByRole('dialog')).not.toContainText(category);
  await page.getByText('补充日期、开封与余量（可选）', { exact: true }).click();
  await choose(page, '日期类型', '计划吃完（自行设定）');
  await page.getByLabel('计划吃完日期', { exact: true }).fill('2026-12-31');
  await page.getByLabel('计划吃完日期', { exact: true }).press('Enter');
  await page.getByLabel('每件剩余量', { exact: true }).fill('1000');
  await choose(page, '每件剩余量单位', 'g');
  await page.getByRole('button', { name: '核对入库信息', exact: true }).click();
  await page.getByRole('button', { name: '确认入库', exact: true }).click();
  await expect(page.getByRole('dialog')).toHaveCount(0);
  await expect(page).toHaveURL(/\/items\/item_/);
  await page.getByRole('button', { name: '记录消耗', exact: true }).click();
  await page.getByLabel('本次消耗量', { exact: true }).fill('125');
  await page.getByRole('button', { name: '确认记录消耗', exact: true }).click();
  await expect(page.getByRole('dialog')).toHaveCount(0);
  const stocked = (await fixtureRead(page)).items.filter(
    (item: any) => item.catalog_node_id === product.id,
  );
  expect(stocked).toHaveLength(1);
  expect(stocked[0].parent_id).toBeNull();
  expect(
    stocked[0].attributes.find((a: any) => a.template_id === 'contents').values.remaining,
  ).toEqual({ value: '875', unit: 'g' });
  expect(
    stocked[0].attributes.find((a: any) => a.template_id === 'lifecycle').values.expiry,
  ).toMatchObject({ date: '2026-12-31', date_kind: 'ESTIMATED' });
});

test('explicitly setting a legacy product type preserves custom capabilities and existing attributes', async ({
  page,
}) => {
  await start(page);
  const name = `旧商品 ${crypto.randomUUID()}`;
  const receipt = await fixtureCommand(page, 'create_catalog_node', {
    kind: 'SKU',
    name,
    capabilities: ['contents'],
    initial_attributes: [
      { template_id: 'product', template_version: 1, values: { brand: 'Keep this brand' } },
    ],
  });
  const id = receipt.affected_objects[0].id;
  await page.goto(`/catalog/${id}?ui=next`);
  await page.getByRole('button', { name: '编辑商品定义', exact: true }).click();
  await choose(page, '商品类型', '消耗品（食品、日用耗材）');
  await confirmCatalog(page);
  const updated = (await fixtureRead(page)).catalog.find((node: any) => node.id === id);
  expect(updated.profile).toBe('CONSUMABLE');
  expect(updated.capabilities).toEqual(['contents']);
  expect(updated.attributes.find((a: any) => a.template_id === 'product').values.brand).toBe(
    'Keep this brand',
  );
});
