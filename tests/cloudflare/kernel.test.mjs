import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { Miniflare, convertV4MiniflareOptions } from 'miniflare';
let mf;
before(async () => {
  mf = new Miniflare(convertV4MiniflareOptions({ modules: true, scriptPath: 'output/cloudflare-test/kernel-worker.js',
    compatibilityDate: '2026-11-05', compatibilityFlags: ['nodejs_compat'],
    durableObjects: { HOUSEHOLDS: { className: 'TestHousehold', useSQLite: true } } }));
});
after(async () => { await mf?.dispose(); });
async function household() {
  const id = crypto.randomUUID();
  const invoke = async (method, ...args) => {
    const response = await mf.dispatchFetch('https://test.invalid/', { method: 'POST', body: JSON.stringify({ route: id, method, args }) });
    const result = await response.json();
    if (!response.ok) throw new Error(result.error);
    return result;
  };
  const stub = Object.fromEntries(['seed', 'revoke', 'consume', 'inspect'].map(method => [method, (...args) => invoke(method, ...args)]));
  await stub.seed(id);
  return { id, stub };
}
test('duplicate concurrent delivery consumes exactly once', async () => {
  const { id, stub } = await household();
  const results = await Promise.all(Array.from({ length: 20 }, () => stub.consume(id, 'same', 3)));
  assert.ok(results.every(r => r.amount === 7));
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
  const results = await Promise.allSettled(Array.from({ length: 20 }, (_, i) => stub.consume(id, String(i), 1)));
  assert.equal(results.filter(r => r.status === 'fulfilled').length, 10);
  assert.deepEqual(await stub.inspect(), { amount: 0, receipts: 10, outbox: 10 });
});
