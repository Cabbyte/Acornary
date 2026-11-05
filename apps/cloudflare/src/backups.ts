import { household, type Env } from './environment.js';
import { backupDescriptor } from './household-backup.js';
import { sha } from './household-import-model.js';
import { blobObjectKey } from './blob-import.js';
import { Memberships } from './memberships.js';
export const authBackupTables = ['user', 'account', 'passkey', 'cf_account_tasks'] as const;
const prefix = (id: string) => `backups/${id}`;
export async function putImmutable(bucket: R2Bucket, key: string, body: string | Uint8Array) {
  const digest = sha(body),
    prior = await bucket.head(key);
  if (prior) {
    const value = await bucket.get(key);
    if (!value || sha(new Uint8Array(await value.arrayBuffer())) !== digest)
      throw new Error('Backup object differs');
  } else {
    const result = await bucket.put(key, body, {
      onlyIf: { etagDoesNotMatch: '*' },
      sha256: digest,
      customMetadata: { sha256: digest },
    });
    if (!result) {
      const value = await bucket.get(key);
      if (!value || sha(new Uint8Array(await value.arrayBuffer())) !== digest)
        throw new Error('Backup object collision');
    }
  }
  return digest;
}
export async function startBackup(env: Env, id: string = crypto.randomUUID()) {
  if (!/^[0-9a-f-]{36}$/.test(id)) throw new Error('Invalid backup ID');
  if (await env.AUTH_DB.prepare('SELECT 1 FROM cf_backup_runs WHERE id=?').bind(id).first())
    return id;
  // Registration/deletion are closed. Recover accepted directory mutations before selecting households.
  const pending = await env.AUTH_DB.prepare(
    "SELECT DISTINCT user_id FROM cf_account_tasks WHERE status='PENDING'",
  ).all<{ user_id: string }>();
  for (const user of pending.results) await new Memberships(env).recover(user.user_id);
  const statements: D1PreparedStatement[] = [
    env.AUTH_DB.prepare(
      "INSERT INTO cf_backup_runs(id,started_at,status,release_commit,retain_until) VALUES(?,?,'PENDING',?,?)",
    ).bind(
      id,
      new Date().toISOString(),
      env.RELEASE_COMMIT,
      new Date(Date.now() + 30 * 86400000).toISOString(),
    ),
  ];
  for (const table of authBackupTables) {
    const { results } = await env.AUTH_DB.prepare(`PRAGMA table_info("${table}")`).all<{
      name: string;
    }>();
    const fields = results
      .flatMap((c) => [
        "'" + c.name.replaceAll("'", "''") + "'",
        '"' + c.name.replaceAll('"', '""') + '"',
      ])
      .join(',');
    statements.push(
      env.AUTH_DB.prepare(
        `INSERT INTO cf_backup_auth SELECT ?,?,id,json_object(${fields}) FROM "${table}"`,
      ).bind(id, table),
    );
  }
  statements.push(
    env.AUTH_DB.prepare(
      "INSERT INTO cf_backup_households(backup_id,household_id) SELECT ?,id FROM household_directory WHERE state='ACTIVE'",
    ).bind(id),
  );
  await env.AUTH_DB.batch(statements);
  await enqueueBackup(env, id);
  return id;
}
export async function enqueueBackup(env: Env, id: string) {
  await env.JOBS.send({ kind: 'BACKUP_FINALIZE', backup_id: id });
  let after = '';
  for (;;) {
    const { results } = await env.AUTH_DB.prepare(
      'SELECT household_id FROM cf_backup_households WHERE backup_id=? AND completed_at IS NULL AND household_id>? ORDER BY household_id LIMIT 100',
    )
      .bind(id, after)
      .all<{ household_id: string }>();
    if (!results.length) break;
    await env.JOBS.sendBatch(
      results.map((row) => ({
        body: { kind: 'BACKUP_HOUSEHOLD', backup_id: id, household_id: row.household_id },
      })),
    );
    after = results.at(-1)!.household_id;
  }
}
export async function backupHousehold(env: Env, id: string, householdId: string) {
  const task = await env.AUTH_DB.prepare(
    'SELECT * FROM cf_backup_households WHERE backup_id=? AND household_id=?',
  )
    .bind(id, householdId)
    .first<{
      descriptor: string | null;
      next_chunk: number;
      after_blob: string;
      completed_at: string | null;
    }>();
  if (!task) throw new Error('Unknown backup task');
  const store = household(env, householdId);
  if (task.completed_at) {
    await store.releaseBackup(id).catch(() => {});
    return;
  }
  const d = task.descriptor
    ? backupDescriptor.parse(JSON.parse(task.descriptor))
    : await store.freezeBackup(id);
  if (d.household_id !== householdId) throw new Error('Backup household differs');
  if (!task.descriptor)
    await env.AUTH_DB.prepare(
      'UPDATE cf_backup_households SET descriptor=? WHERE backup_id=? AND household_id=? AND descriptor IS NULL',
    )
      .bind(JSON.stringify(d), id, householdId)
      .run();
  let next = task.next_chunk;
  // Bound each delivery. A duplicate queue message only rechecks immutable R2 objects.
  for (let page = 0; page < 8 && next < d.chunks; page++) {
    const chunks = await store.backupPage(id, next);
    if (!chunks.length) throw new Error('Frozen household backup is incomplete');
    for (const [index, chunk] of chunks.entries())
      if (chunk.ordinal !== next + index) throw new Error('Backup chunk order differs');
    // A page has at most four bounded chunks. Advance only after every immutable write succeeds.
    // Partial delivery remains replayable and stays below the six outgoing-connection limit.
    const writes = await Promise.allSettled(
      chunks.map((chunk) =>
        putImmutable(
          env.BACKUPS,
          `${prefix(id)}/households/${householdId}/chunks/${chunk.ordinal}.json`,
          chunk.body,
        ),
      ),
    );
    const failed = writes.find((result) => result.status === 'rejected');
    if (failed?.status === 'rejected') throw failed.reason;
    next += chunks.length;
  }
  await env.AUTH_DB.prepare(
    'UPDATE cf_backup_households SET next_chunk=MAX(next_chunk,?) WHERE backup_id=? AND household_id=?',
  )
    .bind(next, id, householdId)
    .run();
  if (next < d.chunks) {
    await env.JOBS.send({ kind: 'BACKUP_HOUSEHOLD', backup_id: id, household_id: householdId });
    return;
  }
  const blobs = await store.frozenBackupBlobs(id, task.after_blob);
  for (const ref of blobs) {
    const object = await env.BLOBS.get(blobObjectKey(ref.storage_key));
    if (!object || object.size > 25 * 1024 * 1024) throw new Error('Backup attachment unavailable');
    const bytes = new Uint8Array(await object.arrayBuffer()),
      hash = sha(bytes);
    if (
      (ref.file_size !== null && ref.file_size !== bytes.length) ||
      (ref.sha256 !== null && ref.sha256 !== hash)
    )
      throw new Error('Backup attachment checksum differs');
    // Register the reference before writing, so GC cannot race an in-flight backup.
    await env.AUTH_DB.prepare(
      "INSERT INTO cf_backup_objects VALUES(?,'LIVE',?) ON CONFLICT DO NOTHING",
    )
      .bind(hash, new Date().toISOString())
      .run();
    await env.AUTH_DB.prepare(
      `INSERT INTO cf_backup_blob_refs SELECT ?,?,?,?,? WHERE EXISTS(SELECT 1 FROM cf_backup_objects WHERE sha256=? AND state='LIVE') ON CONFLICT DO NOTHING`,
    )
      .bind(id, householdId, ref.storage_key, bytes.length, hash, hash)
      .run();
    if (
      !(await env.AUTH_DB.prepare(
        'SELECT 1 FROM cf_backup_blob_refs WHERE backup_id=? AND household_id=? AND storage_key=? AND sha256=?',
      )
        .bind(id, householdId, ref.storage_key, hash)
        .first())
    )
      throw new Error('Backup object cleanup is in progress; retry');
    await putImmutable(env.BACKUPS, `objects/${hash}`, bytes);
  }
  if (blobs.length)
    await env.AUTH_DB.prepare(
      'UPDATE cf_backup_households SET after_blob=MAX(after_blob,?) WHERE backup_id=? AND household_id=?',
    )
      .bind(blobs.at(-1)!.storage_key, id, householdId)
      .run();
  if (blobs.length === 10) {
    await env.JOBS.send({ kind: 'BACKUP_HOUSEHOLD', backup_id: id, household_id: householdId });
    return;
  }
  const { results } = await env.AUTH_DB.prepare(
    'SELECT storage_key,byte_length,sha256 FROM cf_backup_blob_refs WHERE backup_id=? AND household_id=? ORDER BY storage_key',
  )
    .bind(id, householdId)
    .all();
  const manifest = JSON.stringify({ descriptor: d, blobs: results });
  if (Buffer.byteLength(manifest) > 8 * 1024 * 1024)
    throw new Error('Backup manifest exceeds limit');
  const hash = await putImmutable(
    env.BACKUPS,
    `${prefix(id)}/households/${householdId}/manifest.json`,
    manifest,
  );
  await env.AUTH_DB.prepare(
    'UPDATE cf_backup_households SET completed_at=?,manifest_sha256=? WHERE backup_id=? AND household_id=?',
  )
    .bind(new Date().toISOString(), hash, id, householdId)
    .run();
  await store.releaseBackup(id);
  await env.JOBS.send({ kind: 'BACKUP_FINALIZE', backup_id: id });
}
export async function finalizeBackup(env: Env, id: string) {
  const run = await env.AUTH_DB.prepare('SELECT * FROM cf_backup_runs WHERE id=?').bind(id).first<{
    status: string;
    started_at: string;
    release_commit: string;
    auth_manifest: string | null;
  }>();
  if (!run) throw new Error('Unknown backup');
  if (run.status !== 'PENDING') return;
  let authFiles: { key: string; sha256: string; rows: number }[] = [];
  if (run.auth_manifest) authFiles = JSON.parse(run.auth_manifest);
  else {
    for (const table of authBackupTables) {
      let after = '',
        page = 0;
      for (;;) {
        const { results } = await env.AUTH_DB.prepare(
          'SELECT row_id,body FROM cf_backup_auth WHERE backup_id=? AND table_name=? AND row_id>? ORDER BY row_id LIMIT 100',
        )
          .bind(id, table, after)
          .all<{ row_id: string; body: string }>();
        if (!results.length) break;
        const body = JSON.stringify({ table, rows: results.map((r) => JSON.parse(r.body)) });
        if (Buffer.byteLength(body) > 8 * 1024 * 1024)
          throw new Error('Auth backup page exceeds limit');
        const key = `${prefix(id)}/auth/${table}/${page++}.json`;
        authFiles.push({
          key,
          sha256: await putImmutable(env.BACKUPS, key, body),
          rows: results.length,
        });
        after = results.at(-1)!.row_id;
      }
    }
    await env.AUTH_DB.prepare('UPDATE cf_backup_runs SET auth_manifest=? WHERE id=?')
      .bind(JSON.stringify(authFiles), id)
      .run();
  }
  const { results: households } = await env.AUTH_DB.prepare(
    'SELECT household_id,manifest_sha256,completed_at FROM cf_backup_households WHERE backup_id=? ORDER BY household_id',
  )
    .bind(id)
    .all<{ household_id: string; manifest_sha256: string | null; completed_at: string | null }>();
  if (households.some((h) => !h.completed_at)) return;
  // Frozen auth precedes household checkpoints; directory indexes are rebuilt from DO authority.
  const manifest = JSON.stringify({
    format: 'acornary-native-backup-v1',
    id,
    environment: env.ENVIRONMENT,
    origin: env.ORIGIN,
    release_commit: run.release_commit,
    started_at: run.started_at,
    auth: authFiles,
    households: households.map((h) => ({ id: h.household_id, sha256: h.manifest_sha256 })),
  });
  const hash = await putImmutable(env.BACKUPS, `${prefix(id)}/manifest.json`, manifest);
  await env.AUTH_DB.prepare(
    "UPDATE cf_backup_runs SET status='COMPLETE',completed_at=?,manifest_sha256=? WHERE id=?",
  )
    .bind(new Date().toISOString(), hash, id)
    .run();
  await env.AUTH_DB.prepare('DELETE FROM cf_backup_auth WHERE backup_id=?').bind(id).run();
  console.log(
    JSON.stringify({
      job: 'BACKUP',
      outcome: 'COMPLETE',
      backup_id: id,
      households: households.length,
    }),
  );
}
/** Resume incomplete runs before starting the next daily checkpoint. */
export async function scheduledBackup(env: Env) {
  await expireBackups(env);
  const { results } = await env.AUTH_DB.prepare(
    "SELECT id FROM cf_backup_runs WHERE status='PENDING'",
  ).all<{ id: string }>();
  for (const row of results) await enqueueBackup(env, row.id);
  const today = new Date().toISOString().slice(0, 10);
  if (
    !(await env.AUTH_DB.prepare('SELECT 1 FROM cf_backup_runs WHERE started_at>=?')
      .bind(today)
      .first())
  )
    await startBackup(env);
}

/** Expiry removes only completed, unpinned backup sets. Shared bytes use an atomic deletion lease. */
export async function expireBackups(env: Env) {
  await env.AUTH_DB.prepare(
    "UPDATE cf_backup_runs SET status='EXPIRED' WHERE status='COMPLETE' AND pinned=0 AND retain_until<?",
  )
    .bind(new Date().toISOString())
    .run();
  const { results } = await env.AUTH_DB.prepare(
    "SELECT id FROM cf_backup_runs WHERE status='EXPIRED' LIMIT 20",
  ).all<{ id: string }>();
  for (const run of results) {
    const listed = await env.BACKUPS.list({ prefix: `backups/${run.id}/`, limit: 100 });
    if (listed.objects.length) await env.BACKUPS.delete(listed.objects.map((o) => o.key));
    if (listed.truncated) continue;
    await env.AUTH_DB.prepare('DELETE FROM cf_backup_blob_refs WHERE backup_id=?')
      .bind(run.id)
      .run();
    await env.AUTH_DB.prepare(
      "UPDATE cf_backup_runs SET status='PURGED' WHERE id=? AND status='EXPIRED'",
    )
      .bind(run.id)
      .run();
  }
  const { results: objects } = await env.AUTH_DB.prepare(
    "SELECT sha256 FROM cf_backup_objects o WHERE state='DELETING' OR (created_at<? AND NOT EXISTS(SELECT 1 FROM cf_backup_blob_refs r WHERE r.sha256=o.sha256)) LIMIT 100",
  )
    .bind(new Date(Date.now() - 86400000).toISOString())
    .all<{ sha256: string }>();
  for (const object of objects) {
    await env.AUTH_DB.prepare(
      "UPDATE cf_backup_objects SET state='DELETING' WHERE sha256=? AND NOT EXISTS(SELECT 1 FROM cf_backup_blob_refs WHERE sha256=?)",
    )
      .bind(object.sha256, object.sha256)
      .run();
    if (
      !(await env.AUTH_DB.prepare(
        "SELECT 1 FROM cf_backup_objects WHERE sha256=? AND state='DELETING'",
      )
        .bind(object.sha256)
        .first())
    )
      continue;
    await env.BACKUPS.delete(`objects/${object.sha256}`);
    await env.AUTH_DB.prepare("DELETE FROM cf_backup_objects WHERE sha256=? AND state='DELETING'")
      .bind(object.sha256)
      .run();
  }
}
