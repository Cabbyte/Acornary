import { expect, type Page, test } from '@playwright/test';
let ownerCookies: Awaited<ReturnType<import('@playwright/test').BrowserContext['cookies']>> = [];
// Keep the production rate limit in E2E. Wait for a new window only when the
// shared isolated proxy reaches five logins; never bypass or relax the limiter.
export async function login(page: Page) {
  if (!process.env.ACORNARY_E2E_CLOUD) {
    const response = await page.request.get('/api/session');
    expect(response.status()).toBe(200);
    expect(await response.json()).toMatchObject({ mode: 'local', authenticated: true });
    return;
  }
  test.setTimeout(120000);
  const session = await page.request.get('/api/session');
  if (session.ok() && (await session.json()).authenticated) return;
  // Protected routes can still be redirecting to the login document after goto.
  // Wait for that document before restoring cookies or starting a second navigation.
  await expect(
    page
      .getByRole('button', { name: '使用邮箱和密码', exact: true })
      .or(page.getByLabel('邮箱', { exact: true }))
      .first(),
  ).toBeVisible();
  // Reuse a real owner session only for fresh login pages; reauthentication in a
  // pending write sheet still submits credentials without navigating away.
  if (
    ownerCookies.length &&
    !(await page.getByRole('dialog', { name: '重新登录', exact: true }).isVisible())
  ) {
    await page.context().addCookies(ownerCookies);
    const resumed = await page.request.get('/api/session');
    if (resumed.ok() && (await resumed.json()).authenticated) {
      await page.reload();
      if (new URL(page.url()).pathname === '/login')
        await page.waitForURL((url) => url.pathname !== '/login');
      return;
    }
  }
  if (!(await page.getByLabel('邮箱', { exact: true }).isVisible()))
    await page.getByRole('button', { name: '使用邮箱和密码', exact: true }).click();
  await page.getByLabel('邮箱').fill('browser@example.test');
  await page.getByLabel('密码').fill('Browser-test-password-123!');
  for (let attempt = 0; attempt < 2; attempt++) {
    const response = page.waitForResponse((r) => r.url().includes('/api/auth/sign-in/email'));
    await page.getByRole('button', { name: '登录', exact: true }).click();
    const result = await response;
    if (result.status() === 429 && attempt === 0) {
      await page.waitForTimeout(61000);
      continue;
    }
    expect(result.status()).toBe(200);
    await result.finished();
    ownerCookies = await page.context().cookies();
    if (new URL(page.url()).pathname === '/login')
      await page.waitForURL((url) => url.pathname !== '/login');
    return;
  }
}
