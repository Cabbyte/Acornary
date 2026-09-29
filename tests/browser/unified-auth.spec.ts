import { test, expect } from '@playwright/test';
import { createHash } from 'node:crypto';
import { login } from './login.js';
test.beforeEach(() => test.skip(!process.env.ACORNARY_E2E_CLOUD, 'Cloud authentication'));
test('one session, inspector return path, read boundary and cross-tab inspector logout', async ({
  page,
  context,
}) => {
  const scripts: string[] = [];
  page.on('request', (r) => {
    if (r.resourceType() === 'script') scripts.push(r.url());
  });
  await page.goto('/inspect');
  await expect(page.getByRole('heading', { name: '欢迎回到松仓' })).toBeVisible();
  expect(new URL(page.url()).searchParams.get('returnTo')).toBe('/inspect');
  // /inspect initially loads its own shell, but the unified login does not load it.
  scripts.length = 0;
  await page.reload();
  await expect(page.getByLabel('邮箱')).toBeVisible();
  expect(scripts.some((s) => /\/inspector-/.test(s))).toBe(false);
  await login(page);
  await expect(page.getByRole('heading', { name: 'CatalogNode 目录树' })).toBeVisible();
  await page.getByRole('link', { name: '返回松仓' }).click();
  await expect(page.getByRole('heading', { name: '我的物品' })).toBeVisible();
  await page.goto('/settings');
  await page.getByRole('link', { name: '数据库检查器', exact: true }).click();
  await expect(page.getByRole('heading', { name: 'CatalogNode 目录树' })).toBeVisible();
  for (const table of ['user', 'session', 'account', 'jwks', 'oauthRefreshToken', 'rateLimit']) {
    const r = await page.request.get(
      '/api/debug?input=' + encodeURIComponent(JSON.stringify({ view: 'table', table })),
    );
    expect(r.ok()).toBe(false);
  }
  const other = await context.newPage();
  await other.goto('/items');
  await expect(other.getByRole('heading', { name: '我的物品' })).toBeVisible();
  const writes: string[] = [];
  page.on('request', (r) => {
    if (r.method() !== 'GET' && !r.url().endsWith('/sign-out')) writes.push(r.url());
  });
  await page.getByLabel('搜索名称').fill('牛奶');
  await page.reload();
  await expect(page.getByRole('heading', { name: 'CatalogNode 目录树' })).toBeVisible();
  expect(writes).toEqual([]);
  await page.getByRole('button', { name: '退出登录', exact: true }).click();
  await expect(page.getByRole('heading', { name: '欢迎回到松仓' })).toBeVisible();
  await expect(other.getByRole('heading', { name: '欢迎回到松仓' })).toBeVisible();
  expect((await other.request.get('/api/ui/snapshot')).status()).toBe(401);
  expect(
    await page.evaluate(async () => {
      const db = await new Promise<IDBDatabase>((resolve, reject) => {
        const r = indexedDB.open('acornary-web-v1');
        r.onsuccess = () => resolve(r.result);
        r.onerror = () => reject(r.error);
      });
      const count = await new Promise<number>((resolve) => {
        const r = db.transaction('records').objectStore('records').count();
        r.onsuccess = () => resolve(r.result);
      });
      db.close();
      return count;
    }),
  ).toBe(0);
});
test('OAuth login, existing session, deny, expired session recovery, PKCE and untrusted redirects', async ({
  page,
}) => {
  const base = process.env.ACORNARY_E2E_ORIGIN!;
  const verifier = 'browser-acceptance-verifier-with-at-least-forty-three-characters';
  const params = new URLSearchParams({
    client_id: 'browser-client',
    response_type: 'code',
    redirect_uri: 'http://127.0.0.1:45219/callback',
    scope: 'openid offline_access inventory:read',
    resource: 'https://127.0.0.1:3210/mcp',
    state: 'browser-state',
    prompt: 'consent',
    code_challenge_method: 'S256',
    code_challenge: createHash('sha256').update(verifier).digest('base64url'),
  });
  await page.route('http://127.0.0.1:45219/callback**', (r) =>
    r.fulfill({ contentType: 'text/html', body: '<h1>Callback fixture</h1>' }),
  );
  await page.goto('/api/auth/oauth2/authorize?' + params);
  await expect(page.getByRole('heading', { name: '欢迎回到松仓' })).toBeVisible();
  const signedLogin = page.url();
  await login(page);
  await expect(page.getByRole('heading', { name: '授权访问松仓' })).toBeVisible();
  await page.getByRole('button', { name: '拒绝', exact: true }).click();
  await expect(page.getByRole('heading', { name: 'Callback fixture' })).toBeVisible();
  expect(new URL(page.url()).searchParams.get('error')).toBe('access_denied');
  expect(new URL(page.url()).searchParams.get('state')).toBe('browser-state');
  // Revisit a signed login URL with an existing session: continue without password.
  await page.goto(signedLogin);
  await expect(page.getByRole('heading', { name: '授权访问松仓' })).toBeVisible();
  await expect(page.getByLabel('密码')).toHaveCount(0);
  // Expire the server session without a local logout signal to exercise recovery.
  expect(
    (await page.request.post('/api/auth/sign-out', { headers: { Origin: base }, data: {} })).ok(),
  ).toBe(true);
  await page.getByRole('button', { name: '允许', exact: true }).click();
  await expect(page.getByRole('heading', { name: '欢迎回到松仓' })).toBeVisible();
  await login(page);
  await expect(page.getByRole('heading', { name: '授权访问松仓' })).toBeVisible();
  await page.getByRole('button', { name: '允许', exact: true }).click();
  await expect(page.getByRole('heading', { name: 'Callback fixture' })).toBeVisible();
  const callback = new URL(page.url());
  expect(callback.searchParams.get('state')).toBe('browser-state');
  const token = await page.request.post(base + '/api/auth/oauth2/token', {
    headers: { Origin: base },
    form: {
      grant_type: 'authorization_code',
      client_id: 'browser-client',
      code: callback.searchParams.get('code')!,
      code_verifier: verifier,
      redirect_uri: 'http://127.0.0.1:45219/callback',
      resource: 'https://127.0.0.1:3210/mcp',
    },
  });
  expect(token.status(), await token.text()).toBe(200);
  expect((await token.json()).access_token).toBeTruthy();
  for (const destination of [
    'https://evil.example/',
    '//evil.example/',
    '/api/auth/sign-out',
    '/items/../../consent',
    '/\\evil.example/',
  ]) {
    await page.goto(base + '/login?returnTo=' + encodeURIComponent(destination));
    await expect(page.getByRole('heading', { name: '我的物品' })).toBeVisible();
    expect(new URL(page.url()).pathname).toBe('/items');
  }
  await page.goto(
    base +
      '/login?client_id=browser-client&redirect_uri=https://evil.example/&sig=forged&exp=9999999999',
  );
  await expect(page.getByRole('alert')).toContainText('授权未完成');
  expect(new URL(page.url()).origin).toBe(base);
});
