import { test, expect } from '@playwright/test';
import { pageDefinitions } from '../pages/catalog';

// Rendering baseline only: real commands, device results and complete task
// acceptance are separately tracked in the launch matrix.
for (const definition of pageDefinitions) {
  test(`page candidate remains usable at 360px: ${definition.id}`, async ({ page }) => {
    const errors: string[] = [];
    const businessRequests: string[] = [];
    page.on('pageerror', (e) => errors.push(e.message));
    page.on('request', (request) => {
      const url = new URL(request.url());
      if (url.pathname.startsWith('/api/') || url.pathname === '/mcp')
        businessRequests.push(url.href);
    });
    await page.setViewportSize({ width: 360, height: 800 });
    await page.goto(`/?component=${definition.id}&scenario=normal&embed=1`);
    await expect(page.getByRole('heading').first()).toBeVisible();
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(
      true,
    );
    expect(errors).toEqual([]);
    expect(businessRequests).toEqual([]);
  });
}

test('shared opening task keeps its fixture receipt after reload', async ({ page }) => {
  await page.goto('/?component=page-daily-opening&scenario=normal&embed=1');
  await page.getByRole('button', { name: '核对并保存', exact: true }).click();
  const dialog = page.getByRole('dialog');
  await expect(dialog).toBeVisible();
  await dialog.getByRole('button', { name: '确认保存', exact: true }).click();
  await expect(dialog.getByText('结果已取得', { exact: true })).toBeVisible();
  await page.reload();
  await expect(page.getByText('已保存本次记录', { exact: true })).toBeVisible();
  await expect(page.getByRole('button', { name: '核对并保存', exact: true })).toBeDisabled();
});
