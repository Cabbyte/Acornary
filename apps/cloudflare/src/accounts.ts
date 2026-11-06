import { randomBytes, randomUUID } from 'node:crypto';
import { APIError, createAuthEndpoint, getSessionFromCtx } from 'better-auth/api';
import { hashPassword } from 'better-auth/crypto';
import { generateRegistrationOptions, verifyRegistrationResponse } from '@simplewebauthn/server';
import { z } from 'zod';
import { AuthStore } from './auth-store.js';
import { Memberships, digest } from './memberships.js';
import type { Env } from './environment.js';
const fail = (message = '请求已失效，请重新开始。'): never => {
  throw new APIError('BAD_REQUEST', { message });
};
const parse = <T>(schema: z.ZodType<T>, value: unknown): T => {
  const result = schema.safeParse(value);
  return result.success ? result.data : fail('请检查输入格式和长度。');
};
async function setCookie(ctx: any, name: string, token: string, maxAge = 300) {
  const cookie = ctx.context.createAuthCookie(name);
  await ctx.setSignedCookie(cookie.name, token, ctx.context.secret, {
    ...cookie.attributes,
    maxAge,
  });
}
async function cookieHash(ctx: any, name: string) {
  const cookie = ctx.context.createAuthCookie(name),
    token = await ctx.getSignedCookie(cookie.name, ctx.context.secret);
  return token ? digest(token) : '';
}
export function accountsPlugin(env: Env) {
  const store = new AuthStore(env.AUTH_DB),
    memberships = new Memberships(env);
  async function session(ctx: any, fresh = false) {
    const s = await getSessionFromCtx(ctx),
      user = s && (await store.principal(s.user.id));
    if (!s || !user) throw new APIError('UNAUTHORIZED');
    if (fresh && Date.now() - new Date(s.session.createdAt).getTime() > 300000)
      throw new APIError('FORBIDDEN', { message: '请先使用密码或通行密钥重新验证身份。' });
    return { ...s, principal: user };
  }
  const get = (path: string, fn: (ctx: any) => Promise<any>) =>
    createAuthEndpoint(path, { method: 'GET' }, fn);
  const post = (path: string, fn: (ctx: any) => Promise<any>) =>
    createAuthEndpoint(
      path,
      { method: 'POST', body: z.record(z.string(), z.unknown()) },
      async (ctx) => {
        if (ctx.headers?.get('origin') !== env.ORIGIN) throw new APIError('FORBIDDEN');
        await store.limit(
          'account-ip:' + digest(ctx.headers?.get('cf-connecting-ip') ?? 'unknown'),
          100,
          60,
        );
        return fn(ctx);
      },
    );
  const closed = async () => {
    throw new APIError('FORBIDDEN', { message: '暂未开放注册或邮箱找回，请使用已有登录方式。' });
  };
  return {
    id: 'acornary-accounts',
    endpoints: {
      accountCapabilities: get('/account/capabilities', async () => ({
        registration: false,
        recovery: false,
        passkey: true,
      })),
      accountEmailStart: post('/account/email/start', closed),
      accountEmailVerify: post('/account/email/verify', closed),
      accountCompletePassword: post('/account/complete-password', closed),
      accountPasskeyOptions: post('/account/passkey/options', async (ctx) => {
        const mode = parse(z.object({ enrollment: z.boolean().default(false) }), ctx.body);
        if (mode.enrollment) return closed();
        const s = await session(ctx, true),
          existing = await env.AUTH_DB.prepare('SELECT credentialID FROM passkey WHERE userId=?')
            .bind(s.user.id)
            .all<{ credentialID: string }>();
        const options = await generateRegistrationOptions({
          rpName: '松仓',
          rpID: new URL(env.ORIGIN).hostname,
          userName: s.user.email,
          userID: new Uint8Array(new TextEncoder().encode(s.user.id)),
          attestationType: 'none',
          authenticatorSelection: { residentKey: 'required', userVerification: 'required' },
          excludeCredentials: existing.results.map((p) => ({ id: p.credentialID })),
        });
        const token = randomBytes(32).toString('base64url');
        await env.AUTH_DB.prepare('INSERT INTO auth_ceremonies VALUES(?1,?2,?3,?4,?5,?6)')
          .bind(
            digest(token),
            s.user.id,
            options.challenge,
            s.session.id,
            s.principal.auth_version,
            new Date(Date.now() + 300000).toISOString(),
          )
          .run();
        await setCookie(ctx, 'ceremony', token);
        return options;
      }),
      accountPasskeyComplete: post('/account/passkey/complete', async (ctx) => {
        const s = await session(ctx, true),
          body = parse(
            z.object({
              response: z.any(),
              name: z.string().trim().min(1).max(80).default('通行密钥'),
            }),
            ctx.body,
          ),
          ceremonyHash = await cookieHash(ctx, 'ceremony');
        const ceremony = await env.AUTH_DB.prepare(
          'SELECT challenge FROM auth_ceremonies WHERE token_hash=?1 AND user_id=?2 AND session_id=?3 AND auth_version=?4 AND expires_at>?5',
        )
          .bind(
            ceremonyHash,
            s.user.id,
            s.session.id,
            s.principal.auth_version,
            new Date().toISOString(),
          )
          .first<{ challenge: string }>();
        if (!ceremony) return fail();
        let verified;
        try {
          verified = await verifyRegistrationResponse({
            response: body.response,
            expectedChallenge: ceremony.challenge,
            expectedOrigin: env.ORIGIN,
            expectedRPID: new URL(env.ORIGIN).hostname,
            requireUserVerification: true,
          });
        } catch {
          return fail('通行密钥验证失败，请重试。');
        }
        if (!verified.verified || !verified.registrationInfo) return fail();
        const info = verified.registrationInfo;
        await store.registerPasskey(s.principal, s.session.id, ceremonyHash, {
          id: randomUUID(),
          name: body.name,
          publicKey: Buffer.from(info.credential.publicKey).toString('base64'),
          credentialID: info.credential.id,
          counter: info.credential.counter,
          deviceType: info.credentialDeviceType,
          backedUp: info.credentialBackedUp,
          transports: body.response.response.transports?.join(',') ?? '',
          aaguid: info.aaguid,
        });
        await setCookie(ctx, 'ceremony', '', 0);
        return { ok: true };
      }),
      accountCredentials: get('/account/credentials', async (ctx) => {
        const s = await session(ctx),
          password = await env.AUTH_DB.prepare(
            "SELECT 1 FROM account WHERE userId=? AND providerId='credential' AND password IS NOT NULL",
          )
            .bind(s.user.id)
            .first();
        const keys = await env.AUTH_DB.prepare(
          'SELECT id,name,createdAt,deviceType,backedUp FROM passkey WHERE userId=? ORDER BY createdAt',
        )
          .bind(s.user.id)
          .all();
        return {
          email: s.user.email,
          password: !!password,
          passkeys: keys.results.map((p) => ({ ...p, backedUp: !!p.backedUp })),
          fresh: Date.now() - new Date(s.session.createdAt).getTime() < 300000,
        };
      }),
      accountPassword: post('/account/password', async (ctx) => {
        const s = await session(ctx, true),
          { password } = parse(
            z.object({ password: z.string().min(12).max(128).nullable() }),
            ctx.body,
          );
        await store.password(
          s.principal,
          s.session.id,
          password ? await hashPassword(password) : null,
        );
        return { ok: true };
      }),
      accountPasskeyUpdate: post('/account/passkey/update', async (ctx) => {
        const s = await session(ctx, true),
          { id, name } = parse(
            z.object({ id: z.string(), name: z.string().trim().min(1).max(80).nullable() }),
            ctx.body,
          );
        await store.updatePasskey(s.principal, s.session.id, id, name);
        return { ok: true };
      }),
      accountHouseholds: get('/account/households', async (ctx) => ({
        households: await memberships.memberships((await session(ctx)).user.id),
      })),
      accountHouseholdAction: post('/account/household', async (ctx) => {
        const s = await session(ctx),
          body = parse(
            z.object({
              action: z.enum(['create', 'rename', 'members', 'invite', 'revoke', 'leave', 'join']),
              household_id: z.string().optional(),
              name: z.string().trim().min(1).max(80).optional(),
              token: z.string().max(200).optional(),
              invitation_id: z.string().optional(),
            }),
            ctx.body,
          );
        return memberships.action(s.principal, body);
      }),
      accountInvitation: post('/account/invitation', async (ctx) => {
        await session(ctx);
        const { token } = parse(z.object({ token: z.string().max(200) }), ctx.body);
        const invite = await memberships.invitation(token);
        return { name: invite.name };
      }),
    },
  };
}
