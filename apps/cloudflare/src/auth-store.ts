import { APIError } from 'better-auth/api';
import { randomUUID } from 'node:crypto';

export type AuthPrincipal = { id: string; name: string; email: string; auth_version: number };
export class AuthStore {
  constructor(readonly db: D1Database) {}
  principal(id: string) {
    return this.db
      .prepare(
        'SELECT id,name,email,auth_version FROM user WHERE id=? AND enabled=1 AND emailVerified=1',
      )
      .bind(id)
      .first<AuthPrincipal>();
  }
  async limit(key: string, max: number, seconds: number) {
    const now = Math.floor(Date.now() / 1000);
    const row = await this.db
      .prepare(
        `INSERT INTO auth_attempts(key,window_start,attempts) VALUES(?1,?2,1)
      ON CONFLICT(key) DO UPDATE SET window_start=CASE WHEN window_start<=?2-?3 THEN ?2 ELSE window_start END,
      attempts=CASE WHEN window_start<=?2-?3 THEN 1 ELSE attempts+1 END RETURNING attempts`,
      )
      .bind(key, now, seconds)
      .first<{ attempts: number }>();
    if (!row || row.attempts > max) throw new APIError('TOO_MANY_REQUESTS');
  }
  /** An invalid guard aborts the entire batch, including challenge consumption and token revocation. */
  private guard(
    user: AuthPrincipal,
    session: string,
    kind: string,
    condition = '1',
    extra: unknown[] = [],
  ) {
    return this.db
      .prepare(
        `INSERT INTO cf_auth_mutations(id,user_id,kind,authorized,created_at)
      VALUES(?1,?2,?3,(SELECT count(*) FROM user u JOIN session s ON s.userId=u.id
      WHERE u.id=?2 AND u.enabled=1 AND u.emailVerified=1 AND u.auth_version=?4 AND s.id=?5
      AND s.expiresAt>?6 AND s.createdAt>?7 AND (${condition})),?6)`,
      )
      .bind(
        randomUUID(),
        user.id,
        kind,
        user.auth_version,
        session,
        new Date().toISOString(),
        new Date(Date.now() - 300000).toISOString(),
        ...extra,
      );
  }
  private async atomic(statements: D1PreparedStatement[]) {
    try {
      return await this.db.batch(statements);
    } catch (error) {
      // Constraint failures are fail-closed; never leak credential rows or SQL parameters.
      if (/constraint failed|SQLITE_CONSTRAINT/i.test(String(error)))
        throw new APIError('BAD_REQUEST', {
          message: '请求已失效或会移除最后一种登录方式，请重新验证。',
        });
      throw error;
    }
  }
  async password(user: AuthPrincipal, session: string, passwordHash: string | null) {
    const guard = this.guard(
      user,
      session,
      'PASSWORD',
      passwordHash ? '1' : 'EXISTS(SELECT 1 FROM passkey p WHERE p.userId=u.id)',
    );
    const batch = [
      guard,
      this.db
        .prepare("DELETE FROM account WHERE userId=? AND providerId='credential'")
        .bind(user.id),
    ];
    if (passwordHash)
      batch.push(
        this.db
          .prepare(
            "INSERT INTO account(id,accountId,providerId,userId,password,createdAt,updatedAt) VALUES(?1,?2,'credential',?2,?3,?4,?4)",
          )
          .bind(randomUUID(), user.id, passwordHash, new Date().toISOString()),
      );
    batch.push(
      this.db.prepare('UPDATE user SET auth_version=auth_version+1 WHERE id=?').bind(user.id),
    );
    for (const table of ['oauthAccessToken', 'oauthRefreshToken', 'oauthConsent'])
      batch.push(this.db.prepare(`DELETE FROM ${table} WHERE userId=?`).bind(user.id));
    batch.push(
      this.db.prepare('DELETE FROM session WHERE userId=? AND id<>?').bind(user.id, session),
    );
    await this.atomic(batch);
  }
  async updatePasskey(user: AuthPrincipal, session: string, id: string, name: string | null) {
    const own = 'EXISTS(SELECT 1 FROM passkey p WHERE p.id=?8 AND p.userId=u.id)';
    const retained =
      "(EXISTS(SELECT 1 FROM account a WHERE a.userId=u.id AND a.providerId='credential' AND a.password IS NOT NULL) OR (SELECT count(*) FROM passkey p WHERE p.userId=u.id)>1)";
    await this.atomic([
      this.guard(user, session, 'PASSKEY_UPDATE', own + (name ? '' : ` AND ${retained}`), [id]),
      name
        ? this.db
            .prepare('UPDATE passkey SET name=? WHERE id=? AND userId=?')
            .bind(name, id, user.id)
        : this.db.prepare('DELETE FROM passkey WHERE id=? AND userId=?').bind(id, user.id),
    ]);
  }
  async registerPasskey(
    user: AuthPrincipal,
    session: string,
    ceremonyHash: string,
    key: {
      id: string;
      name: string;
      publicKey: string;
      credentialID: string;
      counter: number;
      deviceType: string;
      backedUp: boolean;
      transports: string;
      aaguid: string;
    },
  ) {
    const condition =
      'EXISTS(SELECT 1 FROM auth_ceremonies c WHERE c.token_hash=?8 AND c.user_id=u.id AND c.session_id=s.id AND c.auth_version=u.auth_version AND c.expires_at>?6)';
    await this.atomic([
      this.guard(user, session, 'PASSKEY_REGISTER', condition, [ceremonyHash]),
      this.db.prepare('DELETE FROM auth_ceremonies WHERE token_hash=?').bind(ceremonyHash),
      this.db
        .prepare(
          'INSERT INTO passkey(id,name,publicKey,userId,credentialID,counter,deviceType,backedUp,transports,createdAt,aaguid) VALUES(?1,?2,?3,?4,?5,?6,?7,?8,?9,?10,?11)',
        )
        .bind(
          key.id,
          key.name,
          key.publicKey,
          user.id,
          key.credentialID,
          key.counter,
          key.deviceType,
          Number(key.backedUp),
          key.transports,
          new Date().toISOString(),
          key.aaguid,
        ),
    ]);
  }
}
