import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFile, readdir } from 'node:fs/promises';
import { Miniflare, convertV4MiniflareOptions } from 'miniflare';
import { createHash } from 'node:crypto';
const origin = 'https://cf.backup.invalid';
async function environment() {
  const mf = new Miniflare(
    convertV4MiniflareOptions({
      modules: true,
      scriptPath: 'output/cloudflare-backup/backup-worker.js',
      compatibilityDate: '2026-11-05',
      compatibilityFlags: ['nodejs_compat'],
      durableObjects: { HOUSEHOLDS: { className: 'TestInventory', useSQLite: true } },
      r2Buckets: { BLOBS: 'blobs', BACKUPS: 'backups' },
      d1Databases: { AUTH_DB: 'auth' },
      bindings: { ORIGIN: origin, ENVIRONMENT: 'test', RELEASE_COMMIT: 'backup-test' },
    }),
  );
  const db = await mf.getD1Database('AUTH_DB');
  for (const name of (await readdir('apps/cloudflare/migrations/auth')).sort())
    for (const sql of (await readFile('apps/cloudflare/migrations/auth/' + name, 'utf8'))
      .split(';')
      .filter((s) => s.trim()))
      await db.prepare(sql).run();
  async function call(path, body) {
    const res = await mf.dispatchFetch(origin + path, {
        method: 'POST',
        body: JSON.stringify(body),
      }),
      data = await res.json();
    if (!res.ok) throw new Error(data.error ?? data.message);
    return data;
  }
  return { mf, db, call };
}
test('unified D1/DO/R2 backup restores into empty resources; corruption and missing bytes block activation', async () => {
  const source = await environment(),
    target = await environment();
  try {
    const household = 'household_' + crypto.randomUUID(),
      user = crypto.randomUUID(),
      actor = 'actor_' + crypto.randomUUID(),
      member = crypto.randomUUID(),
      now = new Date().toISOString();
    const ctx = { household_id: household, user_id: user, actor_id: actor, source: 'TEST' };
    const invoke = (env, method, ...args) => env.call('/', { route: household, method, args });
    await source.db
      .prepare(
        'INSERT INTO user(id,name,email,emailVerified,createdAt,updatedAt,enabled,auth_version) VALUES(?,?,?,1,?,?,1,7)',
      )
      .bind(user, '恢复用户', 'backup@example.invalid', now, now)
      .run();
    await source.db
      .prepare(
        "INSERT INTO account(id,accountId,providerId,userId,password,createdAt,updatedAt) VALUES(?,?,'credential',?,'retained-password-hash',?,?)",
      )
      .bind(crypto.randomUUID(), user, user, now, now)
      .run();
    await invoke(source, 'create', {
      household_id: household,
      user_id: user,
      actor_id: actor,
      membership_id: member,
      name: '备份家庭',
      actor_name: '恢复用户',
      timezone: 'Asia/Shanghai',
      operation_id: crypto.randomUUID(),
    });
    const command = async (name, input) =>
      invoke(source, 'command', ctx, name, { idempotency_key: crypto.randomUUID(), ...input });
    const input = { kind: 'SKU', name: '恢复商品', idempotency_key: crypto.randomUUID() };
    const proposal = await command('propose_catalog_change', {
      proposal: {
        kind: 'catalog_command',
        operation: 'create_catalog_node',
        input,
        reason: 'restore fixture',
      },
    });
    const review = await invoke(source, 'review', ctx, 'backup-test', {
      proposal_id: proposal.proposal_id,
    });
    const approval = await invoke(source, 'confirm', ctx, 'backup-test', {
      proposal_id: proposal.proposal_id,
      challenge: review.challenge,
    });
    const catalog = await command('create_catalog_node', {
      ...input,
      approval_id: approval.approval_id,
    });
    const created = await command('create_items', {
      catalog_node_id: catalog.affected_objects[0].id,
      count: 1,
    });
    const item = created.affected_objects[0].id,
      bytes = Buffer.from('%PDF-1.7\nbacked up bytes'),
      hash = createHash('sha256').update(bytes).digest('hex');
    const upload = await command('create_attachment_upload', {
      filename: 'restore.pdf',
      mime_type: 'application/pdf',
      target: { kind: 'ITEM', id: item },
      file_size: bytes.length,
      sha256: hash,
    });
    const transfer = await source.mf.dispatchFetch(origin + '/upload', {
      method: 'PUT',
      headers: {
        'x-test-identity': JSON.stringify(ctx),
        'x-test-upload': upload.upload_id,
        'x-test-ticket': upload.headers['X-Acornary-Upload-Ticket'],
      },
      body: bytes,
    });
    assert.equal(transfer.status, 200, await transfer.text());
    const complete = await command('complete_attachment_upload', {
      upload_id: upload.upload_id,
      target: { kind: 'ITEM', id: item },
      expected_revisions: { [item]: 1 },
    });
    await source.call('/project', { household_id: household });
    const backupId = crypto.randomUUID();
    await source.call('/backup', { id: backupId });
    assert.deepEqual(await source.call('/jobs', {}), { pending: 0, retries: [] });
    const run = await source.db
      .prepare('SELECT * FROM cf_backup_runs WHERE id=?')
      .bind(backupId)
      .first();
    assert.equal(run.status, 'COMPLETE');
    const sourceBucket = await source.mf.getR2Bucket('BACKUPS'),
      targetBucket = await target.mf.getR2Bucket('BACKUPS');
    const objects = await sourceBucket.list();
    for (const obj of objects.objects)
      await targetBucket.put(obj.key, await (await sourceBucket.get(obj.key)).arrayBuffer());
    const restore = async (action, extra = {}) =>
      target.call('/restore', { action, id: backupId, sha256: run.manifest_sha256, ...extra });
    await assert.rejects(
      target.call('/restore', { action: 'begin', id: backupId, sha256: '0'.repeat(64) }),
      /checksum/,
    );
    await restore('begin');
    while (!(await restore('auth')).complete) {}
    const objectKey = 'objects/' + hash;
    await targetBucket.put(objectKey, Buffer.alloc(bytes.length, 0));
    await assert.rejects(async () => {
      while (!(await restore('household', { household_id: household })).complete) {}
    }, /checksum/);
    await assert.rejects(invoke(target, 'snapshot', ctx), /migration is incomplete/);
    await targetBucket.put(objectKey, bytes);
    while (!(await restore('household', { household_id: household })).complete) {}
    assert.equal((await restore('finish')).complete, true);
    assert.equal(
      (await target.db.prepare('SELECT password FROM account WHERE userId=?').bind(user).first())
        .password,
      'retained-password-hash',
    );
    assert.equal(
      (await target.db.prepare('SELECT auth_version FROM user WHERE id=?').bind(user).first())
        .auth_version,
      7,
    );
    assert.equal((await target.db.prepare('SELECT count(*) AS n FROM session').first()).n, 0);
    assert.equal((await invoke(target, 'snapshot', ctx)).items[0].id, item);
    assert.equal(
      (
        await target.db
          .prepare('SELECT user_id FROM membership_directory WHERE household_id=?')
          .bind(household)
          .first()
      ).user_id,
      user,
    );
    const download = await target.mf.dispatchFetch(origin + '/download', {
      headers: {
        'x-test-identity': JSON.stringify(ctx),
        'x-test-attachment': complete.attachment.id,
        'x-test-reveal': 'false',
      },
    });
    assert.equal(download.status, 200);
    assert.deepEqual(Buffer.from(await download.arrayBuffer()), bytes);
    await assert.rejects(
      source.call('/restore', { action: 'begin', id: backupId, sha256: run.manifest_sha256 }),
      /empty identity/,
    );
    await source.db
      .prepare("UPDATE cf_backup_runs SET retain_until='2000-01-01T00:00:00Z',pinned=1 WHERE id=?")
      .bind(backupId)
      .run();
    await source.call('/expire', {});
    assert.equal(
      (
        await source.db
          .prepare('SELECT status FROM cf_backup_runs WHERE id=?')
          .bind(backupId)
          .first()
      ).status,
      'COMPLETE',
    );
    await source.db.prepare('UPDATE cf_backup_runs SET pinned=0 WHERE id=?').bind(backupId).run();
    await source.db.prepare("UPDATE cf_backup_objects SET created_at='2000-01-01T00:00:00Z'").run();
    for (let i = 0; i < 10; i++) {
      await source.call('/expire', {});
      if (
        (
          await source.db
            .prepare('SELECT status FROM cf_backup_runs WHERE id=?')
            .bind(backupId)
            .first()
        ).status === 'PURGED'
      )
        break;
    }
    assert.equal(
      (
        await source.db
          .prepare('SELECT status FROM cf_backup_runs WHERE id=?')
          .bind(backupId)
          .first()
      ).status,
      'PURGED',
    );
    assert.equal(await sourceBucket.get(objectKey), null);
    assert.equal((await (await source.mf.getR2Bucket('BLOBS')).list()).objects.length, 1);
  } finally {
    await Promise.all([source.mf.dispose(), target.mf.dispose()]);
  }
});
