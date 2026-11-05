import { randomUUID, randomBytes, createHash } from 'node:crypto';
import { AsyncLocalStorage } from 'node:async_hooks';
import { APIError } from 'better-auth/api';
import { AuthStore, type AuthPrincipal } from './auth-store.js';
import { AuthDirectory } from './auth-directory.js';
import { household, type Env } from './environment.js';
import type { HouseholdIdentity } from './household-store.js';

export const digest = (value: string) => createHash('sha256').update(value).digest('hex');
export const oauthRequest = new AsyncLocalStorage<{ flow: string }>();
export function oauthFlow(queryString: string) {
  const q = new URLSearchParams(queryString);
  return digest(
    JSON.stringify(
      ['client_id', 'redirect_uri', 'state', 'code_challenge', 'resource', 'scope'].map((k) => [
        k,
        q.getAll(k),
      ]),
    ),
  );
}
export class Memberships {
  readonly accounts: AuthStore;
  constructor(readonly env: Env) {
    this.accounts = new AuthStore(env.AUTH_DB);
  }
  async project(householdId: string) {
    const stub = household(this.env, householdId),
      directory = new AuthDirectory(this.env.AUTH_DB);
    for (const event of await stub.directoryEvents()) {
      await directory.projectHousehold(event.household);
      for (const member of event.memberships) await directory.projectMembership(member);
      for (const invite of event.invitations)
        await this.env.AUTH_DB.prepare(
          'INSERT INTO cf_invitation_directory VALUES(?1,?2,?3) ON CONFLICT(token_hash) DO NOTHING',
        )
          .bind(invite.token_hash, invite.household_id, invite.expires_at)
          .run();
      await stub.acknowledgeDirectory(event.id);
    }
  }
  async memberships(userId: string) {
    await this.recover(userId);
    const { results } = await this.env.AUTH_DB.prepare(
      "SELECT m.id,m.household_id FROM membership_directory m JOIN household_directory h ON h.id=m.household_id WHERE m.user_id=? AND m.deleted=0 AND h.state='ACTIVE' ORDER BY m.id",
    )
      .bind(userId)
      .all<{ id: string; household_id: string }>();
    const members = await Promise.all(
      results.map((m) => household(this.env, m.household_id).resolveMember(m.household_id, userId)),
    );
    return members
      .filter((m): m is NonNullable<typeof m> => !!m)
      .sort((a, b) => a.joined_at.localeCompare(b.joined_at) || a.id.localeCompare(b.id))
      .map(({ id, household_id, actor_id, name }) => ({ id, household_id, actor_id, name }));
  }
  async context(userId: string, householdId: string): Promise<HouseholdIdentity | null> {
    if (!(await this.accounts.principal(userId))) return null;
    const m = await household(this.env, householdId).resolveMember(householdId, userId);
    return m
      ? { user_id: userId, household_id: householdId, actor_id: m.actor_id, source: 'WEB' }
      : null;
  }
  async select(sessionId: string, userId: string, flow: string, householdId: string) {
    const member = (await this.memberships(userId)).find((m) => m.household_id === householdId);
    if (!member) throw new APIError('FORBIDDEN');
    await this.env.AUTH_DB.prepare(
      'INSERT INTO auth_oauth_selections VALUES(?1,?2,?3,?4) ON CONFLICT(session_id,flow_hash) DO UPDATE SET membership_id=excluded.membership_id,expires_at=excluded.expires_at',
    )
      .bind(sessionId, flow, member.id, new Date(Date.now() + 600000).toISOString())
      .run();
  }
  async oauthMembership(sessionId: string, userId: string) {
    const all = await this.memberships(userId),
      flow = oauthRequest.getStore()?.flow;
    const selected =
      flow &&
      (await this.env.AUTH_DB.prepare(
        'SELECT membership_id FROM auth_oauth_selections WHERE session_id=?1 AND flow_hash=?2 AND expires_at>?3',
      )
        .bind(sessionId, flow, new Date().toISOString())
        .first<{ membership_id: string }>());
    return selected
      ? all.find((m) => m.id === selected.membership_id)
      : all.length === 1
        ? all[0]
        : undefined;
  }
  async tokenContext(userId: string, reference?: string) {
    const user = await this.accounts.principal(userId);
    if (!user || !reference) return null;
    const [id, version, ...rest] = reference.split(':');
    if (rest.length || String(user.auth_version) !== version) return null;
    const route = await new AuthDirectory(this.env.AUTH_DB).routeMembership(userId, id);
    if (!route) return null;
    const member = await household(this.env, route.household_id).resolveMember(
      route.household_id,
      userId,
    );
    if (!member || member.id !== id) return null;
    return {
      user_id: userId,
      household_id: member.household_id,
      actor_id: member.actor_id,
      source: 'MCP',
      auth_version: user.auth_version,
    };
  }
  private async apply(task: { id: string; payload: string; kind: string; user_id: string }) {
    const p = JSON.parse(task.payload),
      stub = household(this.env, p.household_id);
    const committed = await stub.accountReceipt(task.id, task.user_id);
    if (!committed) {
      const principal = await this.accounts.principal(task.user_id);
      if (!principal || principal.auth_version !== p.auth_version) {
        await this.env.AUTH_DB.prepare(
          "UPDATE cf_account_tasks SET status='FAILED',result=? WHERE id=?",
        )
          .bind(
            JSON.stringify({ code: 'FORBIDDEN', message: 'Account authorization changed.' }),
            task.id,
          )
          .run();
        throw new APIError('FORBIDDEN');
      }
    }
    const outcome = committed
      ? { value: committed }
      : task.kind === 'create'
        ? { value: await stub.create(p) }
        : await stub.accountTask(p);
    if ('error' in outcome && outcome.error) {
      await this.env.AUTH_DB.prepare(
        "UPDATE cf_account_tasks SET status='FAILED',result=? WHERE id=?",
      )
        .bind(JSON.stringify(outcome.error), task.id)
        .run();
      throw new APIError(outcome.error.code === 'FORBIDDEN' ? 'FORBIDDEN' : 'BAD_REQUEST', {
        message: outcome.error.message,
      });
    }
    const result = outcome.value;
    await this.project(p.household_id);
    const response =
      task.kind === 'invite'
        ? { ...result, url: this.env.ORIGIN + '/join?token=' + p.token }
        : task.kind === 'create'
          ? { household_id: p.household_id }
          : result;
    await this.env.AUTH_DB.prepare(
      "UPDATE cf_account_tasks SET status='COMPLETE',result=? WHERE id=?",
    )
      .bind(JSON.stringify(response), task.id)
      .run();
    return response;
  }
  async recover(userId: string) {
    const { results } = await this.env.AUTH_DB.prepare(
      "SELECT id,payload,kind,user_id FROM cf_account_tasks WHERE user_id=? AND status='PENDING' ORDER BY created_at,id LIMIT 100",
    )
      .bind(userId)
      .all<{ id: string; payload: string; kind: string; user_id: string }>();
    for (const task of results) {
      try {
        await this.apply(task);
      } catch (error) {
        if (!(error instanceof APIError)) throw error;
      }
    }
  }
  async invitation(token: string) {
    const hash = digest(token),
      row = await this.env.AUTH_DB.prepare(
        'SELECT household_id FROM cf_invitation_directory WHERE token_hash=? AND expires_at>?',
      )
        .bind(hash, new Date().toISOString())
        .first<{ household_id: string }>();
    const invite =
      row && (await household(this.env, row.household_id).invitation(row.household_id, hash));
    if (!row || !invite) throw new APIError('BAD_REQUEST', { message: '邀请已过期、撤销或使用。' });
    return { household_id: row.household_id, name: invite.name };
  }
  async action(
    user: AuthPrincipal,
    b: {
      action: string;
      household_id?: string;
      name?: string;
      token?: string;
      invitation_id?: string;
    },
  ) {
    if (b.action === 'members') {
      const ctx = b.household_id && (await this.context(user.id, b.household_id));
      if (!ctx) throw new APIError('FORBIDDEN');
      const result = await household(this.env, ctx.household_id).accountMembers(ctx);
      const members = await Promise.all(
        result.members.map(async (m) =>
          this.env.AUTH_DB.prepare('SELECT id,name,email FROM user WHERE id=?').bind(m.id).first(),
        ),
      );
      return { ...result, members: members.filter(Boolean) };
    }
    if (b.action === 'create' && !b.name) throw new APIError('BAD_REQUEST');
    let hh = b.household_id;
    if (b.action === 'create') hh = 'household_' + randomUUID();
    else if (b.action === 'join') {
      if (!b.token) throw new APIError('BAD_REQUEST');
      hh = (await this.invitation(b.token)).household_id;
    } else if (!hh || !(await this.context(user.id, hh))) throw new APIError('FORBIDDEN');
    if (!hh) throw new APIError('BAD_REQUEST');
    const id = randomUUID(),
      token = b.action === 'invite' ? randomBytes(32).toString('base64url') : b.token;
    const payload = {
      id,
      operation_id: id,
      user_id: user.id,
      auth_version: user.auth_version,
      actor_name: user.name,
      action: b.action,
      household_id: hh,
      name: b.name,
      timezone: 'Asia/Shanghai',
      token,
      token_hash: token ? digest(token) : undefined,
      invitation_id: b.action === 'invite' ? randomUUID() : b.invitation_id,
      expires_at: new Date(Date.now() + 7 * 86400000).toISOString(),
      membership_id: 'member_' + randomUUID(),
      actor_id: 'actor_' + randomUUID(),
    };
    await this.env.AUTH_DB.prepare(
      "INSERT INTO cf_account_tasks(id,user_id,kind,payload,status,created_at) VALUES(?1,?2,?3,?4,'PENDING',?5)",
    )
      .bind(id, user.id, b.action, JSON.stringify(payload), new Date().toISOString())
      .run();
    await this.env.JOBS?.send({ kind: 'ACCOUNT_RECOVER', user_id: user.id });
    return this.apply({ id, user_id: user.id, kind: b.action, payload: JSON.stringify(payload) });
  }
}
