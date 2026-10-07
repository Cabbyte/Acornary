import { test, expect, type Page } from '@playwright/test';
import { createHash } from 'node:crypto';
import { login } from './login.js';
import { choose } from './controls.js';
const widths = [360, 390, 768, 1024, 1440];
async function fixture(page: Page) {
  const headers = {
    Origin: new URL(page.url()).origin,
    'X-Acornary-Request': 'web',
    'X-Acornary-Household': await page.evaluate(
      () => sessionStorage.getItem('acornary-household') ?? '',
    ),
  };
  const write = async (operation: string, input: object) => {
    const r = await page.request.post(`/api/write/${operation}`, {
      headers,
      data: { idempotency_key: crypto.randomUUID(), ...input },
    });
    expect(r.status(), await r.text()).toBe(200);
    return r.json();
  };
  const name = '统一界面验收 ' + crypto.randomUUID().slice(0, 6);
  const sku = (await write('create_catalog_node', { kind: 'SKU', name })).affected_objects[0].id;
  const ids = (
    await write('create_items', {
      catalog_node_id: sku,
      count: 30,
      initial_attributes: [
        {
          template_id: 'contents',
          template_version: 1,
          values: { remaining: { value: '1000.25', unit: 'mL' }, accuracy: 'MEASURED' },
        },
      ],
    })
  ).affected_objects.map((i: any) => i.id) as string[];
  return { name, sku, ids };
}
test('Ant Design cross-page UUID selection, responsive draft, date and keyboard focus', async ({
  page,
}) => {
  await page.goto('/items');
  await login(page);
  await expect(page.getByRole('heading', { name: '我的物品' })).toBeVisible();
  const f = await fixture(page);
  await page.reload();
  await page.getByRole('searchbox', { name: '搜索物品、规格、位置…' }).fill(f.name);
  await page.getByRole('checkbox', { name: '选择本页全部物品' }).check();
  await expect(page.getByText('已选 20 件', { exact: true })).toBeVisible();
  await page.getByTitle('2', { exact: true }).click();
  await page.getByRole('checkbox', { name: '选择本页全部物品' }).check();
  await expect(page.getByText('已选 30 件', { exact: true })).toBeVisible();
  await page.getByRole('button', { name: f.name, exact: true }).first().click();
  await page.getByRole('button', { name: '编辑', exact: true }).click();
  const drawer = page.getByRole('dialog', { name: '编辑物品', exact: true });
  const name = drawer.getByLabel('名称', { exact: true });
  await name.fill('调整窗口后仍保留的草稿');
  let writes = 0;
  page.on('request', (r) => {
    if (r.url().includes('/api/write/')) writes++;
  });
  await drawer.getByLabel('购入日期', { exact: true }).fill('2026-10-07');
  await drawer.getByLabel('购入日期', { exact: true }).press('Enter');
  await choose(page, '状态', '可用');
  await name.dispatchEvent('keydown', {
    key: 'Enter',
    code: 'Enter',
    isComposing: true,
    keyCode: 229,
  });
  expect(writes).toBe(0);
  for (const width of widths) {
    await page.setViewportSize({ width, height: 900 });
    await expect(name).toHaveValue('调整窗口后仍保留的草稿');
    await expect
      .poll(() => page.evaluate(() => document.documentElement.scrollWidth <= innerWidth))
      .toBe(true);
    await page.screenshot({
      animations: 'disabled',
      path: `output/playwright/antd-editor-${width}-${test.info().project.name || process.env.ACORNARY_E2E_BROWSER || 'chromium'}.png`,
    });
  }
  await drawer.getByRole('button', { name: '取消', exact: true }).click();
  await expect(page.getByRole('button', { name: '编辑', exact: true })).toBeFocused();
  await page.getByRole('button', { name: '返回列表', exact: true }).click();
  await expect(page.getByText('已选 30 件', { exact: true })).toBeVisible();
  await page.getByRole('checkbox', { name: '选择本页全部物品' }).uncheck();
  await expect(page.getByText('已选 20 件', { exact: true })).toBeVisible();
});
test('Ant Design visual matrix covers lists, details, long forms, account, authorization and inspector', async ({
  page,
  browser,
}) => {
  test.setTimeout(180000);
  await page.goto('/items');
  await login(page);
  await expect(page.getByRole('heading', { name: '我的物品' })).toBeVisible();
  const f = await fixture(page);
  const routes = [
    ['items', '/items'],
    ['catalog', '/catalog'],
    ['detail', `/items/${f.ids[0]}/details`],
    [
      'long-form',
      `/items/${f.ids[0]}/details?dialog=attributes&target=${f.ids[0]}&template=lifecycle`,
    ],
    ['account', '/settings/account'],
    ['inspector', '/inspect'],
  ];
  const engine = process.env.ACORNARY_E2E_BROWSER ?? 'chromium';
  for (const [name, url] of routes) {
    await page.goto(url);
    await expect(page.getByRole('heading').first()).toBeVisible();
    for (const width of widths) {
      await page.setViewportSize({ width, height: 900 });
      expect(
        await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth),
        `${name} at ${width}`,
      ).toBe(true);
      await page.screenshot({
        animations: 'disabled',
        path: `output/playwright/antd-${name}-${width}-${engine}.png`,
        fullPage: name !== 'long-form',
      });
    }
  }
  const params = new URLSearchParams({
    client_id: 'browser-client',
    response_type: 'code',
    redirect_uri: 'http://127.0.0.1:45219/callback',
    scope: 'openid inventory:read',
    resource: 'https://localhost:3210/mcp',
    state: 'visual-' + crypto.randomUUID(),
    prompt: 'consent',
    code_challenge_method: 'S256',
    code_challenge: createHash('sha256')
      .update('visual-acceptance-verifier-with-at-least-forty-three-characters')
      .digest('base64url'),
  });
  await page.goto('/api/auth/oauth2/authorize?' + params);
  await expect(page.getByRole('heading', { name: '授权访问松仓' })).toBeVisible();
  for (const width of widths) {
    await page.setViewportSize({ width, height: 900 });
    await expect
      .poll(() => page.evaluate(() => document.documentElement.scrollWidth <= innerWidth))
      .toBe(true);
    await page.screenshot({
      animations: 'disabled',
      path: `output/playwright/antd-consent-${width}-${engine}.png`,
      fullPage: true,
    });
  }
  const clean = await browser.newContext({ ignoreHTTPSErrors: true });
  const loginPage = await clean.newPage();
  await loginPage.goto(new URL('/login', page.url()).href);
  await expect(loginPage.getByRole('heading', { name: '欢迎回到松仓' })).toBeVisible();
  for (const width of widths) {
    await loginPage.setViewportSize({ width, height: 900 });
    expect(await loginPage.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(
      true,
    );
    await loginPage.screenshot({
      animations: 'disabled',
      path: `output/playwright/antd-login-${width}-${engine}.png`,
      fullPage: true,
    });
  }
  await clean.close();
});
