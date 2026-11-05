import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { Miniflare, convertV4MiniflareOptions } from 'miniflare';
import { readFile } from 'node:fs/promises';
import { AuthDirectory } from '../../apps/cloudflare/src/auth-directory.ts';
let mf, authDb;
before(async () => {
  mf = new Miniflare(
    convertV4MiniflareOptions({
      modules: true,
      scriptPath: 'output/cloudflare-test/kernel-worker.js',
      compatibilityDate: '2026-11-05',
      compatibilityFlags: ['nodejs_compat'],
      d1Databases: { AUTH_DB: 'auth-test' },
      durableObjects: { HOUSEHOLDS: { className: 'TestHousehold', useSQLite: true } },
    }),
  );
  authDb = await mf.getD1Database('AUTH_DB');
  for (const file of ['0001_better_auth.sql', '0002_directory.sql']) {
    const sql = await readFile('apps/cloudflare/migrations/auth/' + file, 'utf8');
    for (const statement of sql.split(';').filter((s) => s.trim()))
      await authDb.prepare(statement).run();
  }
});
after(async () => {
  await mf?.dispose();
});
async function household() {
  const id = crypto.randomUUID();
  const invoke = async (method, ...args) => {
    const response = await mf.dispatchFetch('https://test.invalid/', {
      method: 'POST',
      body: JSON.stringify({ route: id, method, args }),
    });
    const result = await response.json();
    if (!response.ok) throw new Error(result.error);
    return result;
  };
  const stub = Object.fromEntries(
    ['seed', 'revoke', 'consume', 'inspect', 'largeReceipt', 'payloadStats', 'upgradeV1'].map(
      (method) => [method, (...args) => invoke(method, ...args)],
    ),
  );
  await stub.seed(id);
  return { id, stub };
}
test('duplicate concurrent delivery consumes exactly once', async () => {
  const { id, stub } = await household();
  const results = await Promise.all(Array.from({ length: 20 }, () => stub.consume(id, 'same', 3)));
  assert.ok(results.every((r) => r.amount === 7));
  assert.deepEqual(await stub.inspect(), { amount: 7, receipts: 1, outbox: 1 });
  await assert.rejects(stub.consume(id, 'same', 4), /different parameters/);
});
test('domain mutation, outbox and receipt roll back together', async () => {
  const { id, stub } = await household();
  await assert.rejects(stub.consume(id, 'failure', 3, true), /Injected failure/);
  assert.deepEqual(await stub.inspect(), { amount: 10, receipts: 0, outbox: 0 });
  assert.equal((await stub.consume(id, 'failure', 3)).amount, 7);
});
test('membership revocation prevents replay and cross-household access', async () => {
  const { id, stub } = await household();
  await stub.consume(id, 'key', 2);
  await assert.rejects(stub.consume('another-household', 'key', 2), /Invalid household/);
  await stub.revoke();
  await assert.rejects(stub.consume(id, 'key', 2), /Membership revoked/);
});
test('concurrent distinct writes cannot overdraw inventory', async () => {
  const { id, stub } = await household();
  const results = await Promise.allSettled(
    Array.from({ length: 20 }, (_, i) => stub.consume(id, String(i), 1)),
  );
  assert.equal(results.filter((r) => r.status === 'fulfilled').length, 10);
  assert.deepEqual(await stub.inspect(), { amount: 0, receipts: 10, outbox: 10 });
});

test('UTF-8 receipts larger than a SQLite row replay from transactional chunks', async () => {
  const { id, stub } = await household();
  const first = await stub.largeReceipt(id, 'large', 900000);
  const replay = await stub.largeReceipt(id, 'large', 900000);
  assert.equal(first.text, '松'.repeat(900000));
  assert.deepEqual(replay, first);
  assert.deepEqual(await stub.inspect(), { amount: 9, receipts: 1, outbox: 1 });
  assert.equal((await stub.payloadStats()).payloads, 1);
  assert.ok((await stub.payloadStats()).chunks > 16);
});
test('oversized and rejected receipts roll back inventory, outbox and payload chunks', async () => {
  const { id, stub } = await household();
  await assert.rejects(stub.largeReceipt(id, 'oversized', 1400000), /4 MiB/);
  await assert.rejects(stub.largeReceipt(id, 'rejected', 900000, true), /Injected receipt failure/);
  assert.deepEqual(await stub.inspect(), { amount: 10, receipts: 0, outbox: 0 });
  assert.deepEqual(await stub.payloadStats(), { payloads: 0, chunks: 0 });
});
test('versioned kernel upgrade preserves existing idempotency receipts', async () => {
  const { id, stub } = await household();
  assert.equal(await stub.upgradeV1(), 2);
  assert.deepEqual(await stub.consume(id, 'old-receipt', 2), { amount: 8 });
  assert.deepEqual(await stub.inspect(), { amount: 8, receipts: 1, outbox: 0 });
});

test('D1 directory rejects revoked users and ignores delayed membership projections', async () => {
  await authDb
    .prepare(
      'INSERT INTO user(id,name,email,emailVerified,createdAt,updatedAt,enabled,auth_version) VALUES(?,?,?,1,0,0,1,0)',
    )
    .bind('user', 'Test', 'test@example.invalid')
    .run();
  const directory = new AuthDirectory(authDb);
  await directory.projectHousehold({ id: 'home', name: 'Home', state: 'ACTIVE', revision: '1' });
  const member = {
    id: 'member',
    userId: 'user',
    householdId: 'home',
    deleted: false,
    revision: '9007199254740993',
  };
  await directory.projectMembership(member);
  assert.equal((await directory.routeMembership('user', 'member')).household_id, 'home');
  assert.equal(await directory.routeMembership('other', 'member'), null);
  await directory.projectMembership({ ...member, deleted: true, revision: '9007199254740994' });
  await directory.projectMembership(member);
  assert.equal(await directory.routeMembership('user', 'member'), null);
  assert.equal((await directory.principal('user')).auth_version, 0);
  await authDb.prepare('UPDATE user SET enabled=0 WHERE id=?').bind('user').run();
  assert.equal(await directory.principal('user'), null);
});
