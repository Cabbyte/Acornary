import { before, after, test } from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { Miniflare, convertV4MiniflareOptions } from 'miniflare';
import { AuthStore } from '../../apps/cloudflare/src/auth-store.ts';
let mf, db, store;
before(async () => {
  mf = new Miniflare(
    convertV4MiniflareOptions({
      modules: true,
      script: 'export default {fetch(){return new Response("ok")}}',
      compatibilityDate: '2026-11-05',
      d1Databases: { AUTH_DB: 'native-account-test' },
    }),
  );
  db = await mf.getD1Database('AUTH_DB');
  store = new AuthStore(db);
  for (const name of ['0001_better_auth.sql', '0002_directory.sql', '0004_account_commands.sql']) {
    const source = await readFile('apps/cloudflare/migrations/auth/' + name, 'utf8');
    for (const statement of source.split(';').filter((v) => v.trim()))
      await db.prepare(statement).run();
  }
});
after(async () => {
  await mf?.dispose();
});
async function fixture() {
  const user = {
      id: crypto.randomUUID(),
      name: '测试账号',
      email: crypto.randomUUID() + '@example.invalid',
      auth_version: 0,
    },
    session = crypto.randomUUID(),
    now = new Date().toISOString();
  await db
    .prepare(
      'INSERT INTO user(id,name,email,emailVerified,createdAt,updatedAt,enabled,auth_version) VALUES(?1,?2,?3,1,?4,?4,1,0)',
    )
    .bind(user.id, user.name, user.email, now)
    .run();
  await db
    .prepare(
      'INSERT INTO session(id,token,userId,expiresAt,createdAt,updatedAt) VALUES(?1,?2,?3,?4,?5,?5)',
    )
    .bind(session, crypto.randomUUID(), user.id, new Date(Date.now() + 3600000).toISOString(), now)
    .run();
  await db
    .prepare(
      "INSERT INTO account(id,accountId,providerId,userId,password,createdAt,updatedAt) VALUES(?1,?2,'credential',?2,'old-test-hash',?3,?3)",
    )
    .bind(crypto.randomUUID(), user.id, now)
    .run();
  return { user, session };
}
test('concurrent credential changes consume one auth version and leave one credential', async () => {
  const { user, session } = await fixture();
  const results = await Promise.allSettled(
    Array.from({ length: 10 }, (_, i) => store.password(user, session, 'new-hash-' + i)),
  );
  assert.equal(results.filter((r) => r.status === 'fulfilled').length, 1);
  assert.equal((await store.principal(user.id)).auth_version, 1);
  assert.equal(
    (await db.prepare('SELECT count(*) AS n FROM account WHERE userId=?').bind(user.id).first()).n,
    1,
  );
});
test('last credential and revoked-session guards roll back all account mutations', async () => {
  const { user, session } = await fixture();
  await assert.rejects(store.password(user, session, null));
  assert.equal((await store.principal(user.id)).auth_version, 0);
  assert.equal(
    (await db.prepare('SELECT password FROM account WHERE userId=?').bind(user.id).first())
      .password,
    'old-test-hash',
  );
  await db.prepare('DELETE FROM session WHERE id=?').bind(session).run();
  await assert.rejects(store.password(user, session, 'unexpected'));
  assert.equal((await store.principal(user.id)).auth_version, 0);
});
test('passkey ceremonies are one-use and stale credential versions cannot enroll', async () => {
  const { user, session } = await fixture(),
    ceremony = crypto.randomUUID();
  await db
    .prepare('INSERT INTO auth_ceremonies VALUES(?1,?2,?3,?4,0,?5)')
    .bind(
      ceremony,
      user.id,
      'verified-by-browser',
      session,
      new Date(Date.now() + 300000).toISOString(),
    )
    .run();
  const key = {
    id: crypto.randomUUID(),
    name: '测试通行密钥',
    publicKey: 'test-public-key',
    credentialID: crypto.randomUUID(),
    counter: 0,
    deviceType: 'singleDevice',
    backedUp: false,
    transports: 'internal',
    aaguid: 'test',
  };
  const results = await Promise.allSettled([
    store.registerPasskey(user, session, ceremony, key),
    store.registerPasskey(user, session, ceremony, {
      ...key,
      id: crypto.randomUUID(),
      credentialID: crypto.randomUUID(),
    }),
  ]);
  assert.equal(results.filter((r) => r.status === 'fulfilled').length, 1);
  assert.equal(
    (
      await db
        .prepare('SELECT count(*) AS n FROM auth_ceremonies WHERE user_id=?')
        .bind(user.id)
        .first()
    ).n,
    0,
  );
  const credential = await db
    .prepare('SELECT id FROM passkey WHERE userId=?')
    .bind(user.id)
    .first();
  await store.password(user, session, null);
  const fresh = await store.principal(user.id);
  await assert.rejects(store.updatePasskey(fresh, session, credential.id, null));
  await store.updatePasskey(fresh, session, credential.id, '新的名称');
  assert.equal(
    (await db.prepare('SELECT name FROM passkey WHERE id=?').bind(credential.id).first()).name,
    '新的名称',
  );
});
test('account disable and atomic rate limits remain effective under concurrency', async () => {
  const { user, session } = await fixture();
  await db.prepare('UPDATE user SET enabled=0 WHERE id=?').bind(user.id).run();
  assert.equal(await store.principal(user.id), null);
  await assert.rejects(store.password(user, session, 'unexpected'));
  const attempts = await Promise.allSettled(
    Array.from({ length: 20 }, () => store.limit('test-rate', 5, 60)),
  );
  assert.equal(attempts.filter((r) => r.status === 'fulfilled').length, 5);
});
