import { test, expect } from '@playwright/test';

// Same isolation, state and responsive guarantees as B00, exercised through the
// current RC6 workbench and production components rather than its retired landing page.
test('RC6 appearance changes preserve input across all eight combinations', async ({ page }) => {
  const bad: string[] = [];
  const errors: string[] = [];
  page.on('request', (r) => {
    const u = new URL(r.url());
    if (u.origin !== 'http://127.0.0.1:6007' || u.pathname.startsWith('/api')) bad.push(r.url());
  });
  page.on('pageerror', (e) => errors.push(e.message));
  await page.goto('/?component=input&viewport=390');
  const frame = page.frameLocator('iframe[title="单行输入预览"]');
  const input = frame.getByLabel('显示名称', { exact: true });
  await input.fill('审阅输入保留');
  for (const preset of ['sage', 'apricot', 'berry', 'terracotta']) {
    await page.getByRole('combobox', { name: '配色', exact: true }).selectOption(preset);
    for (const mode of ['daily', 'management']) {
      await page.getByRole('combobox', { name: '模式', exact: true }).selectOption(mode);
      await expect(frame.locator('.vn-root').first()).toHaveAttribute(
        'data-acornary-preset',
        preset,
      );
      await expect(frame.locator('.vn-root').first()).toHaveAttribute('data-acornary-mode', mode);
      await expect(input).toHaveValue('审阅输入保留');
    }
  }
  await page.emulateMedia({ reducedMotion: 'reduce' });
  await expect
    .poll(() =>
      frame
        .locator('.vn-root')
        .first()
        .evaluate((e) => getComputedStyle(e).getPropertyValue('--vn-motion-fast').trim()),
    )
    .toBe('0ms');
  expect(
    await page.evaluate(async () => (await navigator.serviceWorker.getRegistrations()).length),
  ).toBe(0);
  expect(bad).toEqual([]);
  expect(errors).toEqual([]);
});

test('RC6 actual viewport reflows and keyboard actions remain usable', async ({ page }) => {
  for (const width of [320, 360, 390, 768, 1024, 1440, 1920]) {
    await page.setViewportSize({ width, height: 900 });
    await page.goto('/?component=button&scenario=normal&embed=1');
    const button = page.getByRole('button', { name: '继续', exact: true });
    await button.focus();
    await page.keyboard.press('Enter');
    await expect(page.getByRole('status')).toContainText('本地点击：1 次');
    await page.keyboard.press('Space');
    await expect(page.getByRole('status')).toContainText('本地点击：2 次');
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(
      true,
    );
  }
  await page.goto('/?component=button&scenario=disabled&embed=1');
  await expect(page.getByRole('button', { name: '继续', exact: true })).toBeDisabled();
  await page.goto('/?component=input&scenario=error&embed=1');
  await expect(page.getByLabel('显示名称', { exact: true })).toHaveAttribute(
    'aria-invalid',
    'true',
  );
  await page.getByLabel('显示名称', { exact: true }).fill('修正名称');
  await expect(page.getByLabel('显示名称', { exact: true })).not.toHaveAttribute(
    'aria-invalid',
    'true',
  );
});

test('RC6 dialog restores focus and retains draft while busy blocks Escape', async ({ page }) => {
  await page.setViewportSize({ width: 360, height: 780 });
  await page.goto('/?component=dialog&scenario=draft&embed=1');
  const trigger = page.getByRole('button', { name: '打开对话框', exact: true });
  await trigger.click();
  const dialog = page.getByRole('dialog');
  await expect(dialog).toBeVisible();
  await dialog.getByLabel('草稿名称').fill('保留这个草稿');
  await page.keyboard.press('Escape');
  await expect(dialog).not.toBeVisible();
  await expect(trigger).toBeFocused();
  await trigger.click();
  await expect(dialog.getByLabel('草稿名称')).toHaveValue('保留这个草稿');
  await page.goto('/?component=dialog&scenario=busy&embed=1');
  await page.getByRole('button', { name: '打开对话框', exact: true }).click();
  await page.keyboard.press('Escape');
  await expect(page.getByRole('dialog')).toBeVisible();
  await expect(page.getByRole('dialog').getByLabel('草稿名称')).toBeDisabled();
  await page.getByRole('button', { name: '演示：解除关闭限制' }).click();
  await page.keyboard.press('Escape');
  await expect(page.getByRole('dialog')).not.toBeVisible();
});
