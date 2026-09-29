import { test, expect, type Page } from '@playwright/test';
import { randomUUID } from 'node:crypto';
test.beforeEach(() => test.skip(!process.env.ACORNARY_E2E_CLOUD, 'Cloud accounts'));
async function verifyEmail(page: Page, email: string) {
  await page.getByLabel('邮箱', { exact: true }).fill(email);
  await page.getByRole('button', { name: '发送验证码', exact: true }).click();
  await expect(page.getByLabel('邮箱验证码')).toBeVisible();
  const messages = await (
    await page.request.get('/__test/mail?email=' + encodeURIComponent(email))
  ).json();
  await page.getByLabel('邮箱验证码').fill(messages[0].code);
  await page.getByRole('button', { name: '验证邮箱', exact: true }).click();
  await expect(page.getByRole('button', { name: '创建通行密钥', exact: true })).toBeVisible();
}
async function newAuthenticator(page: Page) {
  const cdp = await page.context().newCDPSession(page);
  await cdp.send('WebAuthn.enable');
  const { authenticatorId } = await cdp.send('WebAuthn.addVirtualAuthenticator', {
    options: {
      protocol: 'ctap2',
      transport: 'internal',
      hasResidentKey: true,
      hasUserVerification: true,
      isUserVerified: true,
      automaticPresenceSimulation: true,
    },
  });
  return { cdp, authenticatorId };
}
test('passkey-first registration, optional password, last credential protection, sign-in and household switching', async ({
  page,
}) => {
  await page.setViewportSize({ width: 390, height: 844 });
  const authenticator = await newAuthenticator(page);
  const email = `passkey-${randomUUID()}@example.test`;
  await page.goto('/register');
  await verifyEmail(page, email);
  // Browser cancellation must keep the verified enrollment retryable, with no account yet.
  await page.evaluate(() => {
    const create = navigator.credentials.create.bind(navigator.credentials);
    navigator.credentials.create = async () => {
      navigator.credentials.create = create;
      throw new DOMException('User cancelled', 'NotAllowedError');
    };
  });
  await page.getByRole('button', { name: '创建通行密钥', exact: true }).click();
  await expect(page.getByRole('alert')).toContainText('已取消通行密钥操作');
  expect((await (await page.request.get('/api/session')).json()).authenticated).toBe(false);
  const registrationRequest = page.waitForRequest((r) =>
    r.url().endsWith('/account/passkey/complete'),
  );
  await page.getByRole('button', { name: '创建通行密钥', exact: true }).click();
  await expect(page.getByRole('heading', { name: '需要添加密码吗？' })).toBeVisible();
  const replay = await page.request.post('/api/auth/account/passkey/complete', {
    headers: { Origin: new URL(page.url()).origin },
    data: (await registrationRequest).postDataJSON(),
  });
  expect(replay.status()).toBe(400);
  await page.getByRole('button', { name: '暂时跳过' }).click();
  await expect(page.getByRole('heading', { name: '你的第一个家庭' })).toBeVisible();
  await page.getByLabel('家庭名称', { exact: true }).fill('通行密钥测试家庭');
  await page.getByRole('button', { name: '创建家庭', exact: true }).click();
  await expect(page.getByRole('heading', { name: '我的物品' })).toBeVisible();
  await page.goto('/settings/account');
  await expect(page.getByRole('button', { name: '删除通行密钥' })).toBeDisabled();
  await page.getByRole('button', { name: '添加密码', exact: true }).click();
  await page.getByLabel('新密码', { exact: true }).fill('New-passkey-backup-password!');
  await page.getByLabel('再次输入密码').fill('New-passkey-backup-password!');
  await page.getByRole('button', { name: '保存密码' }).click();
  await expect(page.getByRole('button', { name: '删除通行密钥' })).toBeEnabled();
  page.on('dialog', (d) => d.accept());
  await page.getByRole('button', { name: '移除密码', exact: true }).click();
  await expect(page.getByRole('button', { name: '删除通行密钥' })).toBeDisabled();
  await page.getByLabel('通行密钥名称').fill('我的设备');
  await page.getByRole('button', { name: '保存名称' }).click();
  await page.goto('/settings/households');
  await page.getByLabel('新家庭名称').fill('第二个家庭');
  await page.getByRole('button', { name: '创建另一个家庭' }).click();
  await expect(page.getByRole('heading', { name: '我的物品' })).toBeVisible();
  await page.goto('/settings/households');
  await expect(page.getByLabel('当前家庭').locator('option:checked')).toHaveText('第二个家庭');
  const options = await page
    .getByLabel('当前家庭')
    .locator('option')
    .evaluateAll((nodes) =>
      nodes.map((n) => ({ value: (n as HTMLOptionElement).value, text: n.textContent })),
    );
  await page
    .getByLabel('当前家庭')
    .selectOption(options.find((o) => o.text === '通行密钥测试家庭')!.value);
  await expect(page.getByRole('heading', { name: '我的物品' })).toBeVisible();
  await page.goto('/settings');
  await page.getByRole('button', { name: '退出登录并清除本机缓存' }).click();
  await expect(page.getByRole('button', { name: '使用通行密钥登录' })).toBeVisible();
  await page.getByRole('button', { name: '使用通行密钥登录' }).click();
  await expect(page.getByRole('heading', { name: '我的物品' })).toBeVisible();
  await page.goto('/settings/account');
  await expect(page.getByLabel('通行密钥名称')).toHaveValue('我的设备');
  await page.screenshot({ path: 'output/playwright/accounts-mobile.png', fullPage: true });
  const { credentials } = await authenticator.cdp.send('WebAuthn.getCredentials', {
    authenticatorId: authenticator.authenticatorId,
  });
  expect(credentials).toHaveLength(1);
});
test('password fallback and invitation return do not create an extra household', async ({
  page,
  browser,
}) => {
  const email = `password-${randomUUID()}@example.test`;
  await page.goto('/register');
  await verifyEmail(page, email);
  await page.getByRole('button', { name: '改用邮箱和密码' }).click();
  await page.getByLabel('新密码', { exact: true }).fill('Password-fallback-test-only!');
  await page.getByLabel('再次输入密码').fill('Password-fallback-test-only!');
  await page.getByRole('button', { name: '设置密码并继续' }).click();
  await expect(page.getByRole('heading', { name: '你的第一个家庭' })).toBeVisible();
  await page.getByLabel('家庭名称', { exact: true }).fill('邀请家庭');
  await page.getByRole('button', { name: '创建家庭', exact: true }).click();
  await expect(page.getByRole('heading', { name: '我的物品' })).toBeVisible();
  await page.goto('/settings/households');
  await page.getByRole('button', { name: '创建邀请链接' }).click();
  const link = await page.getByLabel('邀请链接', { exact: true }).inputValue();
  const context = await browser.newContext({ ignoreHTTPSErrors: true });
  const guest = await context.newPage();
  await guest.goto(link);
  await guest.getByRole('link', { name: '创建账号', exact: true }).click();
  await verifyEmail(guest, `guest-${randomUUID()}@example.test`);
  await newAuthenticator(guest);
  await guest.getByRole('button', { name: '创建通行密钥', exact: true }).click();
  await expect(guest.getByRole('heading', { name: '需要添加密码吗？' })).toBeVisible();
  await guest.getByRole('button', { name: '暂时跳过' }).click();
  await expect(guest.getByRole('button', { name: '确认加入 邀请家庭' })).toBeVisible();
  await guest.getByRole('button', { name: '确认加入 邀请家庭' }).click();
  await expect(guest.getByRole('heading', { name: '我的物品' })).toBeVisible();
  const session = await (await guest.request.get(new URL('/api/session', link).toString())).json();
  expect(session.households).toHaveLength(1);
  await context.close();
});

test('email recovery replaces a lost passkey and the old credential cannot authenticate', async ({
  page,
}) => {
  test.setTimeout(120000);
  const email = `recover-${randomUUID()}@example.test`,
    authenticator = await newAuthenticator(page);
  await page.goto('/register');
  await verifyEmail(page, email);
  await page.getByRole('button', { name: '创建通行密钥', exact: true }).click();
  await expect(page.getByRole('heading', { name: '需要添加密码吗？' })).toBeVisible();
  const prior = (
    await authenticator.cdp.send('WebAuthn.getCredentials', {
      authenticatorId: authenticator.authenticatorId,
    })
  ).credentials;
  await authenticator.cdp.send('WebAuthn.removeCredential', {
    authenticatorId: authenticator.authenticatorId,
    credentialId: prior[0].credentialId,
  });
  await page.request.post('/api/auth/sign-out', {
    headers: { Origin: new URL(page.url()).origin },
    data: {},
  });
  // Observe the real per-email resend limit, without a production bypass.
  await page.waitForTimeout(61000);
  await page.goto('/recover');
  await verifyEmail(page, email);
  await page.getByRole('button', { name: '创建通行密钥', exact: true }).click();
  await expect(page.getByRole('heading', { name: '你的第一个家庭' })).toBeVisible();
  const methods = await (await page.request.get('/api/auth/account/credentials')).json();
  expect(methods.password).toBe(false);
  expect(methods.passkeys).toHaveLength(1);
  const credentials = (
    await authenticator.cdp.send('WebAuthn.getCredentials', {
      authenticatorId: authenticator.authenticatorId,
    })
  ).credentials;
  const replacement = credentials.find(
    (c) => !prior.some((p) => p.credentialId === c.credentialId),
  )!;
  expect(replacement).toBeTruthy();
  await authenticator.cdp.send('WebAuthn.removeCredential', {
    authenticatorId: authenticator.authenticatorId,
    credentialId: replacement.credentialId,
  });
  await authenticator.cdp.send('WebAuthn.addCredential', {
    authenticatorId: authenticator.authenticatorId,
    credential: prior[0],
  });
  await page.request.post('/api/auth/sign-out', {
    headers: { Origin: new URL(page.url()).origin },
    data: {},
  });
  await page.goto('/login');
  await page.getByRole('button', { name: '使用通行密钥登录' }).click();
  await expect(page.getByRole('alert')).toBeVisible();
  expect((await (await page.request.get('/api/session')).json()).authenticated).toBe(false);
});
