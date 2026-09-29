import { randomBytes, randomInt, randomUUID, createHmac } from 'node:crypto';
import { APIError, createAuthEndpoint, getSessionFromCtx } from 'better-auth/api';
import { setSessionCookie } from 'better-auth/cookies';
import { hashPassword } from 'better-auth/crypto';
import { generateRegistrationOptions, verifyRegistrationResponse } from '@simplewebauthn/server';
import { z } from 'zod';
import { pool, query, transaction, type Client } from './db.js';
import {
  activeUser,
  memberships,
  memberContext,
  digest,
  leaveHousehold,
  redeemInvitation,
} from './memberships.js';
import { createHousehold } from './initialize.js';
import { disabledAccounts, sendCode } from './mail.js';
import type { RuntimeConfig } from './config.js';

const emailSchema = z.string().trim().toLowerCase().email().max(254);
const passwordSchema = z.string().min(12).max(128);
const fail = (message = '请求已失效，请重新开始。'): never => {
  throw new APIError('BAD_REQUEST', { message });
};
const parse = <T>(schema: z.ZodType<T>, value: unknown): T => {
  const result = schema.safeParse(value);
  return result.success ? result.data : fail('请检查输入格式和长度。');
};
const randomToken = () => randomBytes(32).toString('base64url');
async function setCookie(ctx: any, name: string, token: string, maxAge = 900) {
  const cookie = ctx.context.createAuthCookie(name);
  await ctx.setSignedCookie(cookie.name, token, ctx.context.secret, {
    ...cookie.attributes,
    maxAge,
  });
}
async function cookieHash(ctx: any, name: string) {
  const cookie = ctx.context.createAuthCookie(name);
  const token = await ctx.getSignedCookie(cookie.name, ctx.context.secret);
  return token ? digest(token) : '';
}
export async function accountSession(ctx: any, fresh = false) {
  const session = await getSessionFromCtx(ctx);
  if (!session || !(await activeUser(session.user.id))) throw new APIError('UNAUTHORIZED');
  if (fresh && Date.now() - new Date(session.session.createdAt).getTime() > 300000)
    throw new APIError('FORBIDDEN', { message: '请先使用密码或通行密钥重新验证身份。' });
  return session;
}
async function issueSession(ctx: any, userId: string) {
  const user = await ctx.context.internalAdapter.findUserById(userId);
  const session = await ctx.context.internalAdapter.createSession(userId);
  if (!user || !session) throw new APIError('UNAUTHORIZED');
  await setSessionCookie(ctx, { user, session });
}
async function limit(key: string, max: number, seconds: number) {
  const row = (
    await query(
      pool,
      `INSERT INTO auth_attempts(key,count,expires_at) VALUES($1,1,now()+$2*interval '1 second')
    ON CONFLICT(key) DO UPDATE SET count=CASE WHEN auth_attempts.expires_at<now() THEN 1 ELSE auth_attempts.count+1 END,
    expires_at=CASE WHEN auth_attempts.expires_at<now() THEN excluded.expires_at ELSE auth_attempts.expires_at END RETURNING count`,
      [key, seconds],
    )
  ).rows[0];
  if (row.count > max)
    throw new APIError('TOO_MANY_REQUESTS', { message: '操作过于频繁，请稍后重试。' });
}
async function enrollment(ctx: any) {
  const hash = await cookieHash(ctx, 'enrollment');
  return (
    await query(
      pool,
      'SELECT * FROM auth_enrollments WHERE token_hash=$1 AND verified AND expires_at>now()',
      [hash],
    )
  ).rows[0];
}
async function consumeEnrollment(c: Client, hash: string) {
  const entry = (
    await query(
      c,
      'SELECT * FROM auth_enrollments WHERE token_hash=$1 AND verified AND expires_at>now() FOR UPDATE',
      [hash],
    )
  ).rows[0];
  if (!entry) return fail();
  await query(c, 'SELECT pg_advisory_xact_lock(hashtextextended($1,0))', [entry.email]);
  if (entry.purpose === 'register') {
    if ((await query(c, 'SELECT 1 FROM "user" WHERE lower(email)=$1', [entry.email])).rowCount)
      return fail('此邮箱已有账号，请返回登录。');
    await query(c, 'INSERT INTO "user"(id,name,email,"emailVerified") VALUES($1,$2,$3,true)', [
      entry.user_id,
      entry.email.split('@')[0],
      entry.email,
    ]);
  } else {
    const user = (
      await query(c, 'SELECT * FROM "user" WHERE id=$1 AND enabled AND email=$2 FOR UPDATE', [
        entry.user_id,
        entry.email,
      ])
    ).rows[0];
    if (!user) return fail();
    await query(c, 'UPDATE "user" SET auth_version=auth_version+1 WHERE id=$1', [entry.user_id]);
    await query(c, 'DELETE FROM passkey WHERE "userId"=$1', [entry.user_id]);
    await query(c, 'DELETE FROM account WHERE "userId"=$1', [entry.user_id]);
    await revokeSessions(c, entry.user_id);
  }
  await query(c, 'DELETE FROM auth_enrollments WHERE email=$1', [entry.email]);
  return entry.user_id as string;
}
async function revokeSessions(c: Client, userId: string, keepSession?: string) {
  await query(c, 'DELETE FROM "oauthAccessToken" WHERE "userId"=$1', [userId]);
  await query(c, 'DELETE FROM "oauthRefreshToken" WHERE "userId"=$1', [userId]);
  await query(c, 'DELETE FROM "oauthConsent" WHERE "userId"=$1', [userId]);
  await query(c, 'DELETE FROM session WHERE "userId"=$1 AND id IS DISTINCT FROM $2', [
    userId,
    keepSession ?? null,
  ]);
}

export function accountsPlugin(config: Extract<RuntimeConfig, { mode: 'cloud' }>) {
  const settings = config.accounts ?? disabledAccounts;
  const enabled = (purpose: string) => {
    if (
      settings.mail.transport === 'disabled' ||
      !(purpose === 'register' ? settings.registration : settings.recovery)
    )
      throw new APIError('FORBIDDEN', {
        message:
          purpose === 'register' ? '暂未开放注册。' : '暂未开放邮箱找回，请使用已有登录方式。',
      });
  };
  const codeHash = (tokenHash: string, code: string) =>
    createHmac('sha256', config.secret)
      .update(tokenHash + ':' + code)
      .digest('hex');
  const get = (path: string, fn: (ctx: any) => Promise<any>) =>
    createAuthEndpoint(path, { method: 'GET' }, fn);
  const post = (path: string, fn: (ctx: any) => Promise<any>) =>
    createAuthEndpoint(
      path,
      { method: 'POST', body: z.record(z.string(), z.unknown()) },
      async (ctx) => {
        // Also applies to anonymous enrollment, where a session-based CSRF check is insufficient.
        if (ctx.headers?.get('origin') !== config.origin) throw new APIError('FORBIDDEN');
        await limit('account-ip:' + digest(ctx.headers?.get('x-real-ip') ?? 'unknown'), 100, 60);
        return fn(ctx);
      },
    );
  return {
    id: 'acornary-accounts',
    endpoints: {
      accountCapabilities: get('/account/capabilities', async () => ({
        registration: settings.registration && settings.mail.transport !== 'disabled',
        recovery: settings.recovery && settings.mail.transport !== 'disabled',
        passkey: true,
      })),
      accountEmailStart: post('/account/email/start', async (ctx) => {
        const { email, purpose } = parse(
          z.object({ email: emailSchema, purpose: z.enum(['register', 'recover']) }),
          ctx.body,
        );
        enabled(purpose);
        // Bounded-lived credentials; cleanup never touches application or audit rows.
        for (const table of [
          'auth_enrollments',
          'auth_ceremonies',
          'auth_attempts',
          'auth_oauth_selections',
        ])
          await query(pool, `DELETE FROM ${table} WHERE expires_at<now()`);
        await limit('email-minute:' + digest(email), 1, 60);
        await limit('email-hour:' + digest(email), 10, 3600);
        const token = randomToken(),
          tokenHash = digest(token),
          code = String(randomInt(100000, 1000000));
        const user = (
          await query(pool, 'SELECT id,enabled FROM "user" WHERE lower(email)=$1', [email])
        ).rows[0];
        const eligible = purpose === 'register' ? !user : user?.enabled;
        await query(
          pool,
          `INSERT INTO auth_enrollments(token_hash,email,purpose,user_id,code_hash,expires_at)
        VALUES($1,$2,$3,$4,$5,now()+interval '10 minutes')`,
          [
            tokenHash,
            email,
            purpose,
            purpose === 'recover' && user ? user.id : randomUUID(),
            eligible ? codeHash(tokenHash, code) : null,
          ],
        );
        try {
          if (eligible) await sendCode(settings.mail, email, code, purpose);
        } catch {
          await query(pool, 'DELETE FROM auth_enrollments WHERE token_hash=$1', [tokenHash]);
          throw new APIError('SERVICE_UNAVAILABLE', { message: '邮件发送失败，请稍后重试。' });
        }
        await setCookie(ctx, 'enrollment', token);
        return { ok: true, message: '如果邮箱符合条件，验证码会发送到该邮箱。' };
      }),
      accountEmailVerify: post('/account/email/verify', async (ctx) => {
        const { code, purpose } = parse(
          z.object({ code: z.string().regex(/^\d{6}$/), purpose: z.enum(['register', 'recover']) }),
          ctx.body,
        );
        enabled(purpose);
        const hash = await cookieHash(ctx, 'enrollment');
        const row = (
          await query(
            pool,
            `UPDATE auth_enrollments SET attempts=attempts+1,
        verified=coalesce(code_hash=$2,false), expires_at=CASE WHEN code_hash=$2 THEN now()+interval '15 minutes' ELSE expires_at END
        WHERE token_hash=$1 AND purpose=$3 AND NOT verified AND attempts<5 AND expires_at>now() RETURNING verified`,
            [hash, codeHash(hash, code), purpose],
          )
        ).rows[0];
        if (!row?.verified) return fail('验证码无效或已过期。');
        return { ok: true };
      }),
      accountCompletePassword: post('/account/complete-password', async (ctx) => {
        const { password } = parse(z.object({ password: passwordSchema }), ctx.body);
        const entry = await enrollment(ctx);
        if (!entry) return fail();
        enabled(entry.purpose);
        const hashed = await hashPassword(password);
        const userId = await transaction(async (c) => {
          const id = await consumeEnrollment(c, entry.token_hash);
          await query(
            c,
            'INSERT INTO account(id,"accountId","providerId","userId",password,"updatedAt") VALUES($1,$2,\'credential\',$2,$3,now())',
            [randomUUID(), id, hashed],
          );
          return id;
        });
        await setCookie(ctx, 'enrollment', '', 0);
        await issueSession(ctx, userId);
        return { ok: true };
      }),
      accountPasskeyOptions: post('/account/passkey/options', async (ctx) => {
        const mode = parse(z.object({ enrollment: z.boolean().default(false) }), ctx.body);
        const entry = mode.enrollment ? await enrollment(ctx) : undefined;
        if (mode.enrollment && !entry) return fail();
        const session = entry ? undefined : await accountSession(ctx, true);
        if (entry) enabled(entry.purpose);
        const userId = entry?.user_id ?? session!.user.id;
        const user = await activeUser(userId);
        const existing = (
          await query(pool, 'SELECT "credentialID" FROM passkey WHERE "userId"=$1', [userId])
        ).rows;
        const options = await generateRegistrationOptions({
          rpName: '松仓',
          rpID: new URL(config.origin).hostname,
          userName: entry?.email ?? session!.user.email,
          userID: new TextEncoder().encode(userId),
          attestationType: 'none',
          authenticatorSelection: { residentKey: 'required', userVerification: 'required' },
          excludeCredentials: existing.map((p) => ({ id: p.credentialID })),
        });
        const token = randomToken();
        await query(
          pool,
          `INSERT INTO auth_ceremonies(token_hash,user_id,challenge,enrollment_hash,session_id,auth_version,expires_at)
        VALUES($1,$2,$3,$4,$5,$6,now()+interval '5 minutes')`,
          [
            digest(token),
            userId,
            options.challenge,
            entry?.token_hash ?? null,
            session?.session.id ?? null,
            user?.auth_version ?? 0,
          ],
        );
        await setCookie(ctx, 'ceremony', token, 300);
        return options;
      }),
      accountPasskeyComplete: post('/account/passkey/complete', async (ctx) => {
        const body = parse(
          z.object({
            response: z.any(),
            name: z.string().trim().min(1).max(80).default('通行密钥'),
          }),
          ctx.body,
        );
        const ceremonyHash = await cookieHash(ctx, 'ceremony');
        const ceremony = (
          await query(
            pool,
            'SELECT * FROM auth_ceremonies WHERE token_hash=$1 AND expires_at>now()',
            [ceremonyHash],
          )
        ).rows[0];
        if (!ceremony) return fail();
        let verified;
        try {
          verified = await verifyRegistrationResponse({
            response: body.response,
            expectedChallenge: ceremony.challenge,
            expectedOrigin: config.origin,
            expectedRPID: new URL(config.origin).hostname,
            requireUserVerification: true,
          });
        } catch {
          return fail('通行密钥验证失败，请重试。');
        }
        if (!verified.verified || !verified.registrationInfo) return fail();
        const info = verified.registrationInfo;
        const entry = ceremony.enrollment_hash ? await enrollment(ctx) : undefined;
        if (ceremony.enrollment_hash && entry?.token_hash !== ceremony.enrollment_hash)
          return fail();
        if (entry) enabled(entry.purpose);
        const session = entry ? undefined : await accountSession(ctx, true);
        if (session && session.session.id !== ceremony.session_id) return fail();
        await transaction(async (c) => {
          if (
            !(
              await query(
                c,
                'DELETE FROM auth_ceremonies WHERE token_hash=$1 AND expires_at>now() RETURNING user_id',
                [ceremonyHash],
              )
            ).rowCount
          )
            return fail();
          if (entry) await consumeEnrollment(c, entry.token_hash);
          else {
            const user = (
              await query(c, 'SELECT * FROM "user" WHERE id=$1 AND enabled FOR UPDATE', [
                ceremony.user_id,
              ])
            ).rows[0];
            if (
              !user ||
              user.auth_version !== ceremony.auth_version ||
              !(
                await query(c, 'SELECT 1 FROM session WHERE id=$1 AND "expiresAt">now()', [
                  ceremony.session_id,
                ])
              ).rowCount
            )
              return fail();
          }
          await query(
            c,
            `INSERT INTO passkey(id,name,"publicKey","userId","credentialID",counter,"deviceType","backedUp",transports,"createdAt",aaguid)
          VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,now(),$10)`,
            [
              randomUUID(),
              body.name,
              Buffer.from(info.credential.publicKey).toString('base64'),
              ceremony.user_id,
              info.credential.id,
              info.credential.counter,
              info.credentialDeviceType,
              info.credentialBackedUp,
              body.response.response.transports?.join(',') ?? '',
              info.aaguid,
            ],
          );
        });
        await setCookie(ctx, 'ceremony', '', 0);
        await setCookie(ctx, 'enrollment', '', 0);
        if (entry) await issueSession(ctx, ceremony.user_id);
        return { ok: true };
      }),
      accountCredentials: get('/account/credentials', async (ctx) => {
        const s = await accountSession(ctx);
        return {
          email: s.user.email,
          password: !!(
            await query(
              pool,
              'SELECT 1 FROM account WHERE "userId"=$1 AND "providerId"=\'credential\' AND password IS NOT NULL',
              [s.user.id],
            )
          ).rowCount,
          passkeys: (
            await query(
              pool,
              'SELECT id,name,"createdAt","deviceType","backedUp" FROM passkey WHERE "userId"=$1 ORDER BY "createdAt"',
              [s.user.id],
            )
          ).rows,
          fresh: Date.now() - new Date(s.session.createdAt).getTime() < 300000,
        };
      }),
      accountPassword: post('/account/password', async (ctx) => {
        const s = await accountSession(ctx, true);
        const { password } = parse(z.object({ password: passwordSchema.nullable() }), ctx.body);
        const hashed = password ? await hashPassword(password) : null;
        await transaction(async (c) => {
          await query(c, 'SELECT id FROM "user" WHERE id=$1 FOR UPDATE', [s.user.id]);
          if (
            !(
              await query(c, 'SELECT 1 FROM session WHERE id=$1 AND \"expiresAt\">now()', [
                s.session.id,
              ])
            ).rowCount
          )
            throw new APIError('UNAUTHORIZED');
          if (
            !hashed &&
            !(await query(c, 'SELECT 1 FROM passkey WHERE "userId"=$1', [s.user.id])).rowCount
          )
            return fail('至少保留一种登录方式。');
          await query(c, 'DELETE FROM account WHERE "userId"=$1 AND "providerId"=\'credential\'', [
            s.user.id,
          ]);
          if (hashed)
            await query(
              c,
              'INSERT INTO account(id,"accountId","providerId","userId",password,"updatedAt") VALUES($1,$2,\'credential\',$2,$3,now())',
              [randomUUID(), s.user.id, hashed],
            );
          await query(c, 'UPDATE "user" SET auth_version=auth_version+1 WHERE id=$1', [s.user.id]);
          await revokeSessions(c, s.user.id, s.session.id);
        });
        return { ok: true };
      }),
      accountPasskeyUpdate: post('/account/passkey/update', async (ctx) => {
        const s = await accountSession(ctx, true);
        const { id, name } = parse(
          z.object({ id: z.string(), name: z.string().trim().min(1).max(80).nullable() }),
          ctx.body,
        );
        await transaction(async (c) => {
          await query(c, 'SELECT id FROM "user" WHERE id=$1 FOR UPDATE', [s.user.id]);
          if (
            !(
              await query(c, 'SELECT 1 FROM session WHERE id=$1 AND \"expiresAt\">now()', [
                s.session.id,
              ])
            ).rowCount
          )
            throw new APIError('UNAUTHORIZED');
          const keys = (await query(c, 'SELECT id FROM passkey WHERE "userId"=$1', [s.user.id]))
            .rows;
          if (!keys.some((k) => k.id === id)) throw new APIError('NOT_FOUND');
          if (name)
            await query(c, 'UPDATE passkey SET name=$3 WHERE id=$1 AND "userId"=$2', [
              id,
              s.user.id,
              name,
            ]);
          else {
            if (
              keys.length <= 1 &&
              !(
                await query(c, 'SELECT 1 FROM account WHERE "userId"=$1 AND password IS NOT NULL', [
                  s.user.id,
                ])
              ).rowCount
            )
              return fail('至少保留一种登录方式。');
            await query(c, 'DELETE FROM passkey WHERE id=$1 AND "userId"=$2', [id, s.user.id]);
          }
        });
        return { ok: true };
      }),
      accountHouseholds: get('/account/households', async (ctx) => {
        const s = await accountSession(ctx);
        return { households: await memberships(s.user.id) };
      }),
      accountHouseholdAction: post('/account/household', async (ctx) => {
        const s = await accountSession(ctx);
        const b = parse(
          z.object({
            action: z.enum(['create', 'rename', 'members', 'invite', 'revoke', 'leave', 'join']),
            household_id: z.string().optional(),
            name: z.string().trim().min(1).max(80).optional(),
            token: z.string().max(200).optional(),
            invitation_id: z.string().optional(),
          }),
          ctx.body,
        );
        if (b.action === 'create') {
          if (!b.name) return fail();
          return transaction(async (c) => {
            const created = await createHousehold(c, b.name, 'Asia/Shanghai', s.user.name);
            await query(
              c,
              'INSERT INTO household_members(id,user_id,household_id,actor_id) VALUES($1,$2,$3,$4)',
              ['member_' + randomUUID(), s.user.id, created.household_id, created.actor_id],
            );
            return { household_id: created.household_id };
          });
        }
        if (b.action === 'join') {
          if (!b.token) return fail();
          return redeemInvitation(s.user.id, b.token);
        }
        if (!b.household_id || !(await memberContext(s.user.id, b.household_id)))
          throw new APIError('FORBIDDEN');
        if (b.action === 'rename') {
          if (!b.name) return fail();
          await query(pool, 'UPDATE households SET name=$2,updated_at=now() WHERE id=$1', [
            b.household_id,
            b.name,
          ]);
        }
        if (b.action === 'leave') await leaveHousehold(s.user.id, b.household_id);
        if (b.action === 'members')
          return {
            members: (
              await query(
                pool,
                'SELECT u.id,u.name,u.email FROM household_members m JOIN "user" u ON u.id=m.user_id WHERE m.household_id=$1 ORDER BY m.joined_at',
                [b.household_id],
              )
            ).rows,
            invitations: (
              await query(
                pool,
                'SELECT id,expires_at,revoked,used_by FROM household_invitations WHERE household_id=$1 AND expires_at>now() ORDER BY created_at DESC',
                [b.household_id],
              )
            ).rows,
          };
        if (b.action === 'invite') {
          const token = randomToken(),
            id = randomUUID();
          await query(
            pool,
            `INSERT INTO household_invitations(id,token_hash,household_id,created_by,expires_at) VALUES($1,$2,$3,$4,now()+interval '7 days')`,
            [id, digest(token), b.household_id, s.user.id],
          );
          return { url: config.origin + '/join?token=' + token, id };
        }
        if (b.action === 'revoke')
          await query(
            pool,
            'UPDATE household_invitations SET revoked=true WHERE id=$1 AND household_id=$2',
            [b.invitation_id, b.household_id],
          );
        return { ok: true };
      }),
      accountInvitation: post('/account/invitation', async (ctx) => {
        await accountSession(ctx);
        const { token } = parse(z.object({ token: z.string().max(200) }), ctx.body);
        const invite = (
          await query(
            pool,
            `SELECT h.name FROM household_invitations i JOIN households h ON h.id=i.household_id
        WHERE i.token_hash=$1 AND i.expires_at>now() AND NOT i.revoked AND i.used_by IS NULL`,
            [digest(token)],
          )
        ).rows[0];
        if (!invite) return fail('邀请已过期、撤销或使用。');
        return invite;
      }),
    },
  };
}
