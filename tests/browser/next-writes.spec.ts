import { expect, test, type Page } from '@playwright/test';
import { fixtureCommand, fixtureRead } from './governance.js';
import { login } from './login.js';
import { choose } from './controls.js';

async function fixture(page: Page) {
  await page.goto('/items?ui=next');
  if (process.env.ACORNARY_E2E_CLOUD) {
    await login(page);
    await page.goto('/items?ui=next');
  }
  await expect(page.getByRole('button', { name: '添加物品', exact: true })).toBeVisible();
  const snapshot = await fixtureRead(page);
  const productName = `写入商品 ${crypto.randomUUID()}`;
  const product = {
    id: (
      await fixtureCommand(page, 'create_catalog_node', {
        kind: 'SKU',
        name: productName,
        profile: 'CONSUMABLE',
      })
    ).affected_objects[0].id,
    name: productName,
  };
  const name = `写入验收 ${crypto.randomUUID().slice(0, 6)}`;
  const receipt = await fixtureCommand(page, 'create_items', {
    catalog_node_id: product.id,
    count: 1,
    display_name: name,
    initial_attributes: [
      {
        template_id: 'contents',
        template_version: 1,
        values: { remaining: { value: '1000.25', unit: 'mL' }, accuracy: 'MEASURED' },
      },
    ],
  });
  const id = receipt.affected_objects[0].id;
  await page.goto(`/items/${id}?ui=next`);
  await expect(page.getByRole('heading', { name, exact: true })).toBeVisible();
  return { id, name, product, snapshot };
}

test('intake review, consume, edit, move and notes preserve real command behavior', async ({
  page,
}) => {
  const errors: string[] = [];
  page.on('pageerror', (error) => errors.push(error.message));
  page.on('console', (message) => {
    if (message.type() === 'error') errors.push(message.text());
  });
  const f = await fixture(page);
  await page.getByRole('button', { name: '记录消耗', exact: true }).click();
  await expect(page.getByLabel('本次消耗量', { exact: true })).toBeFocused();
  await page.getByLabel('本次消耗量', { exact: true }).fill('1000.26');
  await expect(page.getByRole('button', { name: '确认记录消耗', exact: true })).toBeDisabled();
  await page.getByLabel('本次消耗量', { exact: true }).fill('200.15');
  await expect(page.getByRole('dialog')).toContainText('800.1 mL');
  await choose(page, '数量依据', '实测值');
  await page.getByRole('button', { name: '确认记录消耗', exact: true }).click();
  await expect(page.getByRole('dialog')).toHaveCount(0);
  await expect(page.getByText('800.1 mL', { exact: true }).first()).toBeVisible();

  await page.getByRole('button', { name: '编辑', exact: true }).click();
  await page.getByLabel('名称', { exact: true }).fill(f.name + ' 已编辑');
  await expect(page.getByLabel('状态', { exact: true })).toHaveCount(0);
  await page.getByRole('button', { name: '保存修改', exact: true }).click();
  await expect(page.getByRole('dialog')).toHaveCount(0);
  await expect(
    page.getByRole('heading', { name: f.name + ' 已编辑', exact: true, level: 1 }),
  ).toBeVisible();

  await page.getByRole('button', { name: '移动', exact: true }).click();
  await page.getByRole('combobox', { name: '目标位置' }).click();
  const destination = f.snapshot.items.find(
    (i: any) => !i.parent_id && i.attributes.some((a: any) => a.template_id === 'container'),
  );
  await page.getByText(`全部位置 / ${destination.display_name}`, { exact: true }).click();
  await page.getByRole('button', { name: '确认移动 1 件', exact: true }).click();
  await expect(page.getByRole('dialog')).toHaveCount(0);

  await page.getByRole('button', { name: '添加笔记', exact: true }).click();
  await page.getByLabel('笔记标题', { exact: true }).fill('使用记录');
  await page.getByLabel('笔记内容', { exact: true }).fill('先使用这一件。');
  await page.getByRole('button', { name: '保存', exact: true }).click();
  await expect(page.getByText('先使用这一件。', { exact: true })).toBeVisible();
  await page.getByRole('button', { name: '编辑笔记', exact: true }).click();
  await expect(page.getByLabel('笔记内容', { exact: true })).toHaveValue('先使用这一件。');
  await page.getByLabel('笔记内容', { exact: true }).fill('更新后的使用记录。');
  await page.getByRole('button', { name: '保存', exact: true }).click();
  await expect(page.getByText('更新后的使用记录。', { exact: true })).toBeVisible();

  await page.goto('/items?ui=next');
  await page.getByRole('button', { name: '添加物品', exact: true }).click();
  await page.getByRole('combobox', { name: '选择商品', exact: true }).click();
  await page
    .getByRole('option')
    .filter({ has: page.getByText(f.product.name, { exact: true }) })
    .click();
  await page.getByRole('button', { name: '核对入库信息', exact: true }).click();
  await expect(page.getByRole('heading', { name: '核对本次入库', exact: true })).toBeVisible();
  await page.getByRole('button', { name: '确认入库', exact: true }).click();
  await expect(page.getByRole('dialog')).toHaveCount(0);
  await expect(page).toHaveURL(/\/items\/item_/);
  const snapshot = await fixtureRead(page);
  const updated = snapshot.items.find((i: any) => i.id === f.id);
  expect(updated.display_name).toBe(f.name + ' 已编辑');
  expect(updated.parent_id).toBe(destination.id);
  expect(
    updated.attributes.find((a: any) => a.template_id === 'contents').values.remaining.value,
  ).toBe('800.1');
  const detail = await fixtureRead(page, 'get_item', { item_id: f.id });
  const note = await fixtureRead(page, 'get_note', { note_id: detail.notes[0].id });
  expect(note.body).toBe('更新后的使用记录。');
  expect(errors).toEqual([]);
});

test('network retry preserves the exact payload, blocks busy close, and restores drafts', async ({
  page,
}) => {
  await fixture(page);
  await page.getByRole('button', { name: '记录消耗', exact: true }).click();
  await page.getByLabel('本次消耗量', { exact: true }).fill('100.25');
  await page.keyboard.press('Escape');
  await expect(page.getByRole('dialog', { name: '关闭并保留草稿？', exact: true })).toBeVisible();
  await page.getByRole('button', { name: '保留草稿并关闭', exact: true }).click();
  await expect(page.getByRole('dialog')).toHaveCount(0);
  await page.getByRole('button', { name: '记录消耗', exact: true }).click();
  await expect(page.getByLabel('本次消耗量', { exact: true })).toHaveValue('100.25');
  const attempts: unknown[] = [];
  let release: () => void = () => {};
  const pending = new Promise<void>((resolve) => {
    release = resolve;
  });
  await page.route('**/api/write/consume_item_content', async (route) => {
    attempts.push(route.request().postDataJSON());
    if (attempts.length === 1) {
      await pending;
      await route.fulfill({
        status: 503,
        contentType: 'application/json',
        body: JSON.stringify({ error: { code: 'NETWORK', request_id: 'retry-test' } }),
      });
    } else await route.continue();
  });
  await page.getByRole('button', { name: '确认记录消耗', exact: true }).click();
  await expect(page.getByRole('button', { name: '正在保存…', exact: true })).toBeDisabled();
  await page.keyboard.press('Escape');
  await expect(page.getByRole('dialog')).toHaveCount(1);
  release();
  await page.getByRole('button', { name: '重试同一次操作', exact: true }).click();
  await expect(page.getByRole('dialog')).toHaveCount(0);
  expect(attempts).toHaveLength(2);
  expect(attempts[1]).toEqual(attempts[0]);
  await expect(page.getByText('900 mL', { exact: true }).first()).toBeVisible();
});

test('revision conflict keeps input and requires reread/review before a new attempt', async ({
  page,
}) => {
  await fixture(page);
  await page.getByRole('button', { name: '记录消耗', exact: true }).click();
  await page.getByLabel('本次消耗量', { exact: true }).fill('100');
  const attempts: any[] = [];
  await page.route('**/api/write/consume_item_content', async (route) => {
    attempts.push(route.request().postDataJSON());
    if (attempts.length === 1)
      await route.fulfill({
        status: 409,
        contentType: 'application/json',
        body: JSON.stringify({
          error: {
            code: 'REVISION_CONFLICT',
            request_id: 'conflict-test',
            recovery: 'REREAD_AND_REVIEW',
          },
        }),
      });
    else await route.continue();
  });
  await page.getByRole('button', { name: '确认记录消耗', exact: true }).click();
  await expect(page.getByRole('heading', { name: '核对最新记录', exact: true })).toBeVisible();
  await expect(page.getByLabel('本次消耗量', { exact: true })).toHaveValue('100');
  await expect(page.getByRole('button', { name: '确认记录消耗', exact: true })).toBeDisabled();
  await page.getByRole('button', { name: '已核对，保留我的输入', exact: true }).click();
  await page.getByRole('button', { name: '确认记录消耗', exact: true }).click();
  await expect(page.getByRole('dialog')).toHaveCount(0);
  expect(attempts[1].idempotency_key).not.toBe(attempts[0].idempotency_key);
  expect(attempts[1].amount).toEqual(attempts[0].amount);
});

test('offline keeps editable drafts and disables submit until inventory is reread', async ({
  page,
  context,
}) => {
  await fixture(page);
  await page.getByRole('button', { name: '记录消耗', exact: true }).click();
  await page.getByLabel('本次消耗量', { exact: true }).fill('10');
  await context.setOffline(true);
  await expect(page.getByRole('button', { name: '确认记录消耗', exact: true })).toBeDisabled();
  await expect(page.getByLabel('本次消耗量', { exact: true })).toHaveValue('10');
  await context.setOffline(false);
  await expect(page.getByRole('button', { name: '确认记录消耗', exact: true })).toBeEnabled();
});

test('read-only sessions cannot edit fields or submit a directly linked write sheet', async ({
  page,
}) => {
  const f = await fixture(page);
  await page.route('**/api/session', async (route) => {
    const response = await route.fetch();
    await route.fulfill({ response, json: { ...(await response.json()), can_write: false } });
  });
  await page.goto(`/items/${f.id}?ui=next&dialog=consume&target=${f.id}`);
  await expect(page.getByLabel('本次消耗量', { exact: true })).toBeDisabled();
  await expect(page.getByRole('button', { name: '确认记录消耗', exact: true })).toBeDisabled();
});
