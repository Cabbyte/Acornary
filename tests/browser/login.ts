import { expect, type Page, test } from '@playwright/test';
// Keep the production rate limit in E2E. Wait for a new window only when the
// shared isolated proxy reaches five logins; never bypass or relax the limiter.
export async function login(page: Page) {
  test.setTimeout(120000);
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
    return;
  }
}
