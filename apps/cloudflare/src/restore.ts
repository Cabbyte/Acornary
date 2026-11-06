import { z } from 'zod';
import { authBackupTables, putImmutable } from './backups.js';
import { backupDescriptor } from './household-backup.js';
import { sha } from './household-import-model.js';
import { household, type Env } from './environment.js';
import { blobObjectKey } from './blob-import.js';
import { Memberships } from './memberships.js';
const digest = z.string().regex(/^[a-f0-9]{64}$/),
  hhId = z.string().regex(/^household_[a-f0-9-]{36}$/);
const rootSchema = z.strictObject({
  format: z.literal('acornary-native-backup-v1'),
  id: z.string().uuid(),
  environment: z.enum(['preview', 'production', 'test']),
  origin: z.string().url(),
  release_commit: z.string(),
  started_at: z.string().datetime(),
  auth: z.array(
    z.strictObject({ key: z.string(), sha256: digest, rows: z.number().int().positive() }),
  ),
  households: z.array(z.strictObject({ id: hhId, sha256: digest })),
});
export async function verifiedJSON(bucket: R2Bucket, key: string, expected: string) {
  digest.parse(expected);
  const value = await bucket.get(key);
  if (!value || value.size > 8 * 1024 * 1024)
    throw new Error('Bounded backup object is unavailable');
  const text = await value.text();
  if (sha(text) !== expected) throw new Error('Backup checksum differs');
  return JSON.parse(text);
}
export class Restore {
  constructor(private readonly env: Env) {}
  async manifest(id: string, expected: string) {
    z.string().uuid().parse(id);
    const m = rootSchema.parse(
      await verifiedJSON(this.env.BACKUPS, `backups/${id}/manifest.json`, expected),
    );
    if (m.id !== id || m.environment !== this.env.ENVIRONMENT || m.origin !== this.env.ORIGIN)
      throw new Error('Backup environment or origin differs');
    if (new Set(m.households.map((h) => h.id)).size !== m.households.length)
      throw new Error('Duplicate backup household');
    return m;
  }
  async begin(id: string, expected: string) {
    await this.manifest(id, expected);
    await this.env.AUTH_DB.prepare(
      `INSERT INTO cf_restore_job(singleton,backup_id,manifest_sha256,status) SELECT 1,?,?,'IMPORTING' WHERE NOT EXISTS(SELECT 1 FROM user) AND NOT EXISTS(SELECT 1 FROM household_directory) AND NOT EXISTS(SELECT 1 FROM cf_account_tasks) AND NOT EXISTS(SELECT 1 FROM cf_auth_import) ON CONFLICT(singleton) DO NOTHING`,
    )
      .bind(id, expected)
      .run();
    const job = await this.env.AUTH_DB.prepare(
      'SELECT * FROM cf_restore_job WHERE singleton=1',
    ).first<{ backup_id: string; manifest_sha256: string }>();
    if (job?.backup_id !== id || job.manifest_sha256 !== expected)
      throw new Error('Restore requires an empty identity database or the identical plan');
  }
  private async job(id: string, expected: string) {
    const job = await this.env.AUTH_DB.prepare(
      'SELECT * FROM cf_restore_job WHERE singleton=1 AND backup_id=? AND manifest_sha256=?',
    )
      .bind(id, expected)
      .first<{ status: string; next_auth_file: number }>();
    if (!job) throw new Error('Restore is not reserved');
    return job;
  }
  async auth(id: string, expected: string) {
    const m = await this.manifest(id, expected),
      job = await this.job(id, expected);
    if (job.status !== 'IMPORTING') return { complete: true };
    const file = m.auth[job.next_auth_file];
    if (!file) {
      await this.env.AUTH_DB.prepare(
        "UPDATE cf_restore_job SET status='AUTH_READY' WHERE singleton=1",
      ).run();
      return { complete: true };
    }
    const data = await verifiedJSON(this.env.BACKUPS, file.key, file.sha256);
    const table = z.enum(authBackupTables).parse(data.table);
    if (!file.key.startsWith(`backups/${id}/auth/${table}/`))
      throw new Error('Auth backup path differs');
    const rows = z
      .array(z.record(z.string(), z.union([z.string(), z.number().finite(), z.null()])))
      .parse(data.rows);
    if (rows.length !== file.rows || rows.length > 100)
      throw new Error('Auth backup count differs');
    const { results } = await this.env.AUTH_DB.prepare(`PRAGMA table_info("${table}")`).all<{
      name: string;
    }>();
    const columns = results.map((c) => c.name);
    if (
      rows.some(
        (r) => JSON.stringify(Object.keys(r).sort()) !== JSON.stringify([...columns].sort()),
      )
    )
      throw new Error('Auth restore schema differs');
    const batch = [
      this.env.AUTH_DB.prepare(
        `INSERT INTO cf_restore_files VALUES(?,?,CASE WHEN EXISTS(SELECT 1 FROM cf_restore_job WHERE singleton=1 AND next_auth_file=? AND status='IMPORTING') THEN 1 ELSE 0 END)`,
      ).bind(job.next_auth_file, file.sha256, job.next_auth_file),
      ...rows.map((row) =>
        this.env.AUTH_DB.prepare(
          `INSERT INTO "${table}"(${columns.map((c) => '"' + c + '"').join(',')}) VALUES(${columns.map(() => '?').join(',')})`,
        ).bind(...columns.map((c) => row[c])),
      ),
      this.env.AUTH_DB.prepare(
        'UPDATE cf_restore_job SET next_auth_file=next_auth_file+1 WHERE singleton=1',
      ),
    ];
    await this.env.AUTH_DB.batch(batch);
    return { complete: false, next: job.next_auth_file + 1 };
  }
  async household(id: string, expected: string, householdId: string) {
    hhId.parse(householdId);
    const m = await this.manifest(id, expected),
      job = await this.job(id, expected);
    if (job.status === 'IMPORTING') throw new Error('Identity restore must finish first');
    const ref = m.households.find((h) => h.id === householdId);
    if (!ref) throw new Error('Household is absent from backup');
    const data = z
      .strictObject({
        descriptor: backupDescriptor,
        blobs: z.array(
          z.strictObject({
            storage_key: digest,
            byte_length: z
              .number()
              .int()
              .positive()
              .max(25 * 1024 * 1024),
            sha256: digest,
          }),
        ),
      })
      .parse(
        await verifiedJSON(
          this.env.BACKUPS,
          `backups/${id}/households/${householdId}/manifest.json`,
          ref.sha256,
        ),
      );
    if (
      data.descriptor.household_id !== householdId ||
      data.descriptor.id !== id ||
      new Set(data.blobs.map((b) => b.storage_key)).size !== data.blobs.length
    )
      throw new Error('Household manifest differs');
    await this.env.AUTH_DB.prepare(
      'INSERT INTO cf_restore_households(household_id) VALUES(?) ON CONFLICT DO NOTHING',
    )
      .bind(householdId)
      .run();
    const task = (await this.env.AUTH_DB.prepare(
      'SELECT * FROM cf_restore_households WHERE household_id=?',
    )
      .bind(householdId)
      .first<{ next_chunk: number; after_blob: string; completed: number }>())!;
    if (task.completed) return { complete: true };
    const store = household(this.env, householdId);
    await store.beginRestore(data.descriptor);
    let next = task.next_chunk;
    for (let n = 0; n < 32 && next < data.descriptor.chunks; n++, next++) {
      const object = await this.env.BACKUPS.get(
        `backups/${id}/households/${householdId}/chunks/${next}.json`,
      );
      if (!object || object.size > 140 * 1024) throw new Error('Restore chunk unavailable');
      await store.restorePart(id, next, await object.text());
    }
    await this.env.AUTH_DB.prepare(
      'UPDATE cf_restore_households SET next_chunk=MAX(next_chunk,?) WHERE household_id=?',
    )
      .bind(next, householdId)
      .run();
    if (next < data.descriptor.chunks) return { complete: false, next_chunk: next };
    await store.finishRestore(id);
    const blobs = data.blobs
      .filter((b) => b.storage_key > task.after_blob)
      .sort((a, b) => a.storage_key.localeCompare(b.storage_key))
      .slice(0, 10);
    for (const blob of blobs) {
      const object = await this.env.BACKUPS.get(`objects/${blob.sha256}`);
      if (!object || object.size !== blob.byte_length)
        throw new Error('Restored attachment is unavailable');
      const bytes = new Uint8Array(await object.arrayBuffer());
      if (sha(bytes) !== blob.sha256) throw new Error('Restored attachment checksum differs');
      await putImmutable(this.env.BLOBS, blobObjectKey(blob.storage_key), bytes);
      await store.confirmRestoredBlob(blob.storage_key, blob.byte_length, blob.sha256);
    }
    if (blobs.length)
      await this.env.AUTH_DB.prepare(
        'UPDATE cf_restore_households SET after_blob=MAX(after_blob,?) WHERE household_id=?',
      )
        .bind(blobs.at(-1)!.storage_key, householdId)
        .run();
    if (blobs.length === 10) return { complete: false };
    await store.activateRestore(id);
    await new Memberships(this.env).project(householdId);
    await this.env.AUTH_DB.prepare(
      'UPDATE cf_restore_households SET completed=1 WHERE household_id=?',
    )
      .bind(householdId)
      .run();
    return { complete: true };
  }
  async finish(id: string, expected: string) {
    const m = await this.manifest(id, expected),
      job = await this.job(id, expected);
    if (job.status === 'IMPORTING') throw new Error('Identity restore is incomplete');
    const { results } = await this.env.AUTH_DB.prepare(
      'SELECT household_id FROM cf_restore_households WHERE completed=1',
    ).all<{ household_id: string }>();
    if (
      results.length !== m.households.length ||
      m.households.some((h) => !results.some((r) => r.household_id === h.id))
    )
      throw new Error('Household restore is incomplete');
    await this.env.AUTH_DB.prepare(
      "UPDATE cf_restore_job SET status='COMPLETE' WHERE singleton=1",
    ).run();
    return { complete: true, households: results.length };
  }
}
