import { randomUUID, createHash } from 'node:crypto';
import { AsyncLocalStorage } from 'node:async_hooks';
import { APIError } from 'better-auth/api';
import { pool, query, transaction } from './db.js';
import type { Context } from './service.js';
export const digest = (value: string) => createHash('sha256').update(value).digest('hex');
export async function activeUser(id: string) {
  return (
    await query(
      pool,
      `SELECT u.* FROM "user" u WHERE u.id=$1 AND u.enabled
    AND NOT EXISTS(SELECT 1 FROM auth_owners o WHERE o.user_id=u.id AND NOT o.enabled)`,
      [id],
    )
  ).rows[0];
}
export async function memberships(userId: string) {
  return (
    await query(
      pool,
      `SELECT m.id,m.household_id,m.actor_id,h.name FROM household_members m
    JOIN households h ON h.id=m.household_id WHERE m.user_id=$1 ORDER BY m.joined_at,m.id`,
      [userId],
    )
  ).rows;
}
export async function memberContext(userId: string, householdId: string): Promise<Context | null> {
  if (!(await activeUser(userId))) return null;
  const member = (await memberships(userId)).find((m) => m.household_id === householdId);
  return member
    ? { household_id: member.household_id, actor_id: member.actor_id, source: 'WEB' }
    : null;
}
// Only pre-migration tokens may use this mapping, and only while their original membership survives.
export async function legacyContext(userId: string): Promise<Context | null> {
  const user = await activeUser(userId);
  if (!user || user.auth_version !== 0) return null;
  const row = (
    await query(
      pool,
      `SELECT m.household_id,m.actor_id FROM household_members m JOIN auth_owners o
    ON o.user_id=m.user_id AND o.actor_id=m.actor_id AND o.household_id=m.household_id
    WHERE m.user_id=$1 AND o.enabled`,
      [userId],
    )
  ).rows[0];
  return row ? { ...row, source: 'MCP' } : null;
}
export const oauthRequest = new AsyncLocalStorage<{ flow: string }>();
export function oauthFlow(queryString: string) {
  const q = new URLSearchParams(queryString);
  // Stable across the provider's signed login/selection/consent continuations.
  return digest(
    JSON.stringify(
      ['client_id', 'redirect_uri', 'state', 'code_challenge', 'resource', 'scope'].map((k) => [
        k,
        q.getAll(k),
      ]),
    ),
  );
}
export async function selectOAuthHousehold(
  sessionId: string,
  userId: string,
  flow: string,
  householdId: string,
) {
  const member = (await memberships(userId)).find((m) => m.household_id === householdId);
  if (!member) throw new APIError('FORBIDDEN');
  await query(
    pool,
    `INSERT INTO auth_oauth_selections(session_id,flow_hash,membership_id,expires_at)
    VALUES($1,$2,$3,now()+interval '10 minutes') ON CONFLICT(session_id,flow_hash)
    DO UPDATE SET membership_id=$3,expires_at=excluded.expires_at`,
    [sessionId, flow, member.id],
  );
}
export async function oauthMembership(sessionId: string, userId: string) {
  const all = await memberships(userId);
  const flow = oauthRequest.getStore()?.flow;
  const selected =
    flow &&
    (
      await query(
        pool,
        `SELECT membership_id FROM auth_oauth_selections
    WHERE session_id=$1 AND flow_hash=$2 AND expires_at>now()`,
        [sessionId, flow],
      )
    ).rows[0];
  return selected
    ? all.find((m) => m.id === selected.membership_id)
    : all.length === 1
      ? all[0]
      : undefined;
}
export async function tokenContext(
  userId: string,
  reference?: string,
): Promise<(Context & { auth_version: number }) | null> {
  const user = await activeUser(userId);
  if (!user) return null;
  if (!reference) {
    const legacy = await legacyContext(userId);
    return legacy ? { ...legacy, auth_version: 0 } : null;
  }
  const [id, version] = reference.split(':');
  if (String(user.auth_version) !== version) return null;
  const member = (await memberships(userId)).find((m) => m.id === id);
  return member
    ? {
        household_id: member.household_id,
        actor_id: member.actor_id,
        source: 'MCP',
        auth_version: user.auth_version,
      }
    : null;
}
export async function leaveHousehold(userId: string, householdId: string) {
  await transaction(async (c) => {
    await query(c, 'SELECT id FROM households WHERE id=$1 FOR UPDATE', [householdId]);
    const members = (
      await query(c, 'SELECT * FROM household_members WHERE household_id=$1', [householdId])
    ).rows;
    if (!members.some((m) => m.user_id === userId)) throw new APIError('FORBIDDEN');
    if (members.length < 2)
      throw new APIError('BAD_REQUEST', { message: '最后一名成员不能退出家庭。' });
    await query(c, 'DELETE FROM household_members WHERE household_id=$1 AND user_id=$2', [
      householdId,
      userId,
    ]);
  });
}
export async function redeemInvitation(userId: string, token: string) {
  return transaction(async (c) => {
    const invite = (
      await query(
        c,
        `SELECT * FROM household_invitations WHERE token_hash=$1
      AND NOT revoked AND used_by IS NULL AND expires_at>now() FOR UPDATE`,
        [digest(token)],
      )
    ).rows[0];
    if (!invite) throw new APIError('BAD_REQUEST', { message: '邀请已过期、撤销或使用。' });
    await query(c, 'SELECT id FROM households WHERE id=$1 FOR UPDATE', [invite.household_id]);
    if (
      (
        await query(c, 'SELECT 1 FROM household_members WHERE user_id=$1 AND household_id=$2', [
          userId,
          invite.household_id,
        ])
      ).rowCount
    )
      throw new APIError('BAD_REQUEST', { message: '你已经是这个家庭的成员。' });
    const actorId = 'actor_' + randomUUID();
    await query(
      c,
      'INSERT INTO actors(id,household_id,name) SELECT $1,$2,name FROM "user" WHERE id=$3',
      [actorId, invite.household_id, userId],
    );
    await query(
      c,
      'INSERT INTO household_members(id,user_id,household_id,actor_id) VALUES($1,$2,$3,$4)',
      ['member_' + randomUUID(), userId, invite.household_id, actorId],
    );
    await query(c, 'UPDATE household_invitations SET used_by=$2 WHERE id=$1', [invite.id, userId]);
    return { household_id: invite.household_id };
  });
}
