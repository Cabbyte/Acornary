import nodemailer from 'nodemailer';
import { beforeAll, afterAll, describe, it, expect, vi } from 'vitest';
import { randomUUID } from 'node:crypto';
import { buildApp } from '../apps/server/src/app.js';
import { initialize } from '../apps/server/src/initialize.js';
import { pool, query } from '../apps/server/src/db.js';
import { testMailbox, accountConfig } from '../apps/server/src/mail.js';
import { tokenContext, memberships } from '../apps/server/src/memberships.js';
import type { RuntimeConfig } from '../apps/server/src/config.js';
const config: Extract<RuntimeConfig, { mode: 'cloud' }> = {
  mode: 'cloud',
  origin: 'https://accounts.example.test',
  resource: 'https://accounts.example.test/mcp',
  trustedProxy: '172.30.78.10',
  secret: 'isolated-test-only-secret-at-least-32-characters',
  accounts: { registration: true, recovery: true, mail: { transport: 'test' } },
};
let app: Awaited<ReturnType<typeof buildApp>>;
const password = 'A-long-test-only-password!';
function browser(ip = '203.0.113.' + Math.floor(Math.random() * 200 + 1), application = app) {
  const jar = new Map<string, string>();
  return {
    jar,
    async call(path: string, body?: object, household?: string) {
      const r = await application.inject({
        method: body ? 'POST' : 'GET',
        url: path.startsWith('/api/') ? path : '/api/auth/' + path,
        remoteAddress: config.trustedProxy,
        headers: {
          host: 'accounts.example.test',
          'x-forwarded-proto': 'https',
          origin: config.origin,
          'x-real-ip': ip,
          cookie: [...jar].map(([k, v]) => `${k}=${v}`).join('; '),
          ...(body ? { 'content-type': 'application/json' } : {}),
          ...(household ? { 'x-acornary-household': household } : {}),
          'x-acornary-request': 'web',
        },
        payload: body,
      });
      const cookies = r.headers['set-cookie'];
      for (const s of typeof cookies === 'string' ? [cookies] : (cookies ?? [])) {
        const pair = s.split(';')[0],
          idx = pair.indexOf('=');
        jar.set(pair.slice(0, idx), pair.slice(idx + 1));
      }
      return r;
    },
  };
}
async function verified(b: ReturnType<typeof browser>, email: string, purpose = 'register') {
  expect((await b.call('account/email/start', { email, purpose })).statusCode).toBe(200);
  const message = testMailbox.findLast((m) => m.to === email)!;
  expect(message).toBeTruthy();
  const result = await b.call('account/email/verify', { code: message.code, purpose });
  expect(result.statusCode, result.body).toBe(200);
}
async function register() {
  const b = browser(),
    email = `account-${randomUUID()}@example.test`;
  await verified(b, email);
  const r = await b.call('account/complete-password', { password });
  expect(r.statusCode, r.body).toBe(200);
  const session = (await b.call('/api/session')).json();
  expect(session.authenticated).toBe(true);
  expect(session.households).toEqual([]);
  return { b, email, userId: session.user_id };
}
beforeAll(async () => {
  if (!new URL(process.env.DATABASE_URL!).pathname.endsWith('acornary_test'))
    throw Error('Isolated database required');
  app = await buildApp({ ...(await initialize()), source: 'TEST' }, '', false, config);
  await app.ready();
});
afterAll(async () => {
  await app.close();
  await pool.end();
});
describe('email, optional credentials and household isolation', () => {
  it('validates disabled, SMTP and test-mail capabilities without exposing credentials', () => {
    expect(accountConfig({})).toMatchObject({
      registration: false,
      recovery: false,
      mail: { transport: 'disabled' },
    });
    expect(() => accountConfig({ ACORNARY_REGISTRATION_ENABLED: 'true' })).toThrow();
    expect(() =>
      accountConfig({
        ACORNARY_MAIL_TRANSPORT: 'test',
        NODE_ENV: 'production',
        DATABASE_URL: process.env.DATABASE_URL,
      }),
    ).toThrow();
    expect(() => accountConfig({ ACORNARY_MAIL_TRANSPORT: 'smtp' })).toThrow();
  });
  it('enforces disabled production capabilities at the HTTP boundary', async () => {
    const blocked = await buildApp({ ...(await initialize()), source: 'TEST' }, '', false, {
      ...config,
      accounts: undefined,
    });
    try {
      const b = browser('203.0.113.240', blocked);
      expect((await b.call('account/capabilities')).json()).toMatchObject({
        registration: false,
        recovery: false,
      });
      for (const purpose of ['register', 'recover'])
        expect(
          (await b.call('account/email/start', { email: 'disabled@example.test', purpose }))
            .statusCode,
        ).toBe(403);
      expect((await b.call('account/complete-password', { password })).statusCode).toBe(400);
      expect((await b.call('account/passkey/options', {})).statusCode).toBe(401);
    } finally {
      await blocked.close();
    }
  });
  it('expired verified enrollment cannot create an account', async () => {
    const b = browser(),
      email = `expired-${randomUUID()}@example.test`;
    await verified(b, email);
    await query(
      pool,
      "UPDATE auth_enrollments SET expires_at=now()-interval '1 second' WHERE email=$1",
      [email],
    );
    expect((await b.call('account/complete-password', { password })).statusCode).toBe(400);
    expect((await query(pool, 'SELECT 1 FROM "user" WHERE email=$1', [email])).rowCount).toBe(0);
  });
  it('mail delivery failure does not leave a usable verification challenge', async () => {
    const transport = vi.spyOn(nodemailer, 'createTransport').mockReturnValue({
      sendMail: async () => {
        throw Error('isolated delivery failure');
      },
    } as any);
    const smtp = await buildApp({ ...(await initialize()), source: 'TEST' }, '', false, {
      ...config,
      accounts: {
        registration: true,
        recovery: true,
        mail: {
          transport: 'smtp',
          host: 'smtp.example.test',
          port: 587,
          secure: false,
          user: 'test',
          password: 'test',
          from: 'test@example.test',
        },
      },
    });
    const email = `failed-mail-${randomUUID()}@example.test`;
    try {
      expect(
        (
          await browser('203.0.113.241', smtp).call('account/email/start', {
            email,
            purpose: 'register',
          })
        ).statusCode,
      ).toBe(503);
      expect(
        (await query(pool, 'SELECT 1 FROM auth_enrollments WHERE email=$1', [email])).rowCount,
      ).toBe(0);
    } finally {
      transport.mockRestore();
      await smtp.close();
    }
  });
  it('a pending registration cannot redirect account-settings enrollment into another account', async () => {
    const { b, email } = await register(),
      pending = `pending-${randomUUID()}@example.test`;
    await verified(b, pending);
    expect((await b.call('account/passkey/options', {})).json().user.name).toBe(email);
    expect((await b.call('account/passkey/options', { enrollment: true })).json().user.name).toBe(
      pending,
    );
    expect((await query(pool, 'SELECT 1 FROM "user" WHERE email=$1', [pending])).rowCount).toBe(0);
  });
  it('requires verified email, rejects wrong-purpose/replayed verification, and limits guesses/resends', async () => {
    const b = browser(),
      email = `verify-${randomUUID()}@example.test`;
    expect((await b.call('account/complete-password', { password })).statusCode).toBe(400);
    await b.call('account/email/start', { email, purpose: 'register' });
    const code = testMailbox.findLast((m) => m.to === email)!.code;
    expect((await b.call('account/email/verify', { code, purpose: 'recover' })).statusCode).toBe(
      400,
    );
    expect((await b.call('account/email/start', { email, purpose: 'register' })).statusCode).toBe(
      429,
    );
    for (let i = 0; i < 5; i++)
      expect(
        (await b.call('account/email/verify', { code: '000000', purpose: 'register' })).statusCode,
      ).toBe(400);
    expect((await b.call('account/email/verify', { code, purpose: 'register' })).statusCode).toBe(
      400,
    );
    const other = browser(),
      otherEmail = `verify-${randomUUID()}@example.test`;
    await verified(other, otherEmail);
    const again = await other.call('account/email/verify', {
      code: testMailbox.findLast((m) => m.to === otherEmail)!.code,
      purpose: 'register',
    });
    expect(again.statusCode).toBe(400);
    expect((await query(pool, 'SELECT 1 FROM "user" WHERE email=$1', [otherEmail])).rowCount).toBe(
      0,
    );
  });
  it('creates an account only once and does not allow removing the last credential or enrolling without fresh login', async () => {
    const { b, email, userId } = await register();
    expect((await b.call('account/complete-password', { password })).statusCode).toBe(400);
    expect((await b.call('account/password', { password: null })).statusCode).toBe(400);
    const methods = (await b.call('account/credentials')).json();
    expect(methods).toMatchObject({ password: true, passkeys: [] });
    await query(
      pool,
      'UPDATE session SET "createdAt"=now()-interval \'10 minutes\' WHERE "userId"=$1',
      [userId],
    );
    expect((await b.call('account/password', { password: password + '2' })).statusCode).toBe(403);
    expect((await b.call('account/passkey/options', {})).statusCode).toBe(403);
    // Existing-account signup must not emit a code, even with a different cookie jar.
    await query(pool, "DELETE FROM auth_attempts WHERE key LIKE 'email-%'");
    const other = browser(),
      n = testMailbox.length;
    expect(
      (await other.call('account/email/start', { email, purpose: 'register' })).statusCode,
    ).toBe(200);
    expect(testMailbox).toHaveLength(n);
  });
  it('shares a household through a single-use invitation and rejects cross-household API and inspector access', async () => {
    const a = await register(),
      b = await register(),
      c = await register();
    const home = (
      await a.b.call('account/household', { action: 'create', name: 'Shared household' })
    ).json().household_id;
    const other = (
      await c.b.call('account/household', { action: 'create', name: 'Private household' })
    ).json().household_id;
    const invite = (
      await a.b.call('account/household', { action: 'invite', household_id: home })
    ).json();
    const token = new URL(invite.url).searchParams.get('token')!;
    const joins = await Promise.all([
      b.b.call('account/household', { action: 'join', token }),
      c.b.call('account/household', { action: 'join', token }),
    ]);
    expect(joins.map((r) => r.statusCode).sort()).toEqual([200, 400]);
    const joined = joins[0].statusCode === 200 ? b : c;
    const body = { kind: 'SKU', name: 'Shared SKU', idempotency_key: randomUUID() };
    const write = await a.b.call('/api/write/create_catalog_node', body, home);
    expect(write.statusCode, write.body).toBe(200);
    const id = write.json().affected_objects[0].id;
    expect(
      (await joined.b.call('/api/ui/snapshot', undefined, home))
        .json()
        .catalog.some((x: any) => x.id === id),
    ).toBe(true);
    expect((await a.b.call('/api/ui/snapshot', undefined, other)).statusCode).toBe(403);
    expect((await a.b.call('/api/write/create_catalog_node', body, other)).statusCode).toBe(403);
    expect(
      (
        await a.b.call(
          '/api/debug?input=' +
            encodeURIComponent(JSON.stringify({ view: 'system', table: 'passkey' })),
          undefined,
          home,
        )
      ).statusCode,
    ).toBe(400);
    expect((await a.b.call('/api/ui/snapshot')).statusCode).toBe(403);
    const revoked = (
      await a.b.call('account/household', { action: 'invite', household_id: home })
    ).json();
    await a.b.call('account/household', {
      action: 'revoke',
      household_id: home,
      invitation_id: revoked.id,
    });
    expect(
      (
        await joined.b.call('account/invitation', {
          token: new URL(revoked.url).searchParams.get('token'),
        })
      ).statusCode,
    ).toBe(400);
    const expired = (
      await a.b.call('account/household', { action: 'invite', household_id: home })
    ).json();
    await query(
      pool,
      "UPDATE household_invitations SET expires_at=now()-interval '1 second' WHERE id=$1",
      [expired.id],
    );
    expect(
      (
        await joined.b.call('account/invitation', {
          token: new URL(expired.url).searchParams.get('token'),
        })
      ).statusCode,
    ).toBe(400);

    const ref = (await memberships(joined.userId)).find((m) => m.household_id === home).id + ':0';
    expect(await tokenContext(joined.userId, ref)).toBeTruthy();
    expect(
      (await joined.b.call('account/household', { action: 'leave', household_id: home }))
        .statusCode,
    ).toBe(200);
    expect(await tokenContext(joined.userId, ref)).toBeNull();
    expect(
      (await a.b.call('account/household', { action: 'leave', household_id: home })).statusCode,
    ).toBe(400);
  });
  it('recovery replaces credentials, revokes existing sessions and invalidates even unexpired token references', async () => {
    const { b, email, userId } = await register();
    const home = (
      await b.call('account/household', { action: 'create', name: 'Recovery household' })
    ).json().household_id;
    const ref = (await memberships(userId))[0].id + ':0';
    await query(pool, "DELETE FROM auth_attempts WHERE key LIKE 'email-%'");
    const recover = browser();
    await verified(recover, email, 'recover');
    const result = await recover.call('account/complete-password', {
      password: password + 'reset',
    });
    expect(result.statusCode, result.body).toBe(200);
    expect((await b.call('/api/session')).json().authenticated).toBe(false);
    expect(await tokenContext(userId, ref)).toBeNull();
    expect((await recover.call('/api/ui/snapshot', undefined, home)).statusCode).toBe(200);
    expect((await browser().call('sign-in/email', { email, password })).statusCode).toBe(401);
    expect(
      (await browser().call('sign-in/email', { email, password: password + 'reset' })).statusCode,
    ).toBe(200);
  });
});
