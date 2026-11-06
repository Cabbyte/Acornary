import { z } from 'zod';
import { NativeDatabase } from './inventory/db.js';
import { householdSchemaVersion } from './inventory/schema.js';
import { householdImportTables, sha } from './household-import-model.js';
import { directoryEvent } from './household-accounts.js';

// Ephemeral uploads/exports and source import state are intentionally not restored.
const tables = [
  'cf_payloads',
  'cf_payload_chunks',
  ...householdImportTables,
  'cf_account_receipts',
  'cf_outbox',
  'cf_directory_clock',
] as const;
const digest = z.string().regex(/^[a-f0-9]{64}$/);
export const backupDescriptor = z.strictObject({
  format: z.literal('acornary-native-household-v1'),
  id: z.string().uuid(),
  household_id: z.string().regex(/^household_[a-f0-9-]{36}$/),
  schema: z.literal(householdSchemaVersion),
  created_at: z.string().datetime(),
  chunks: z.number().int().positive().max(10_000_000),
  root: digest,
  counts: z.record(z.string(), z.number().int().nonnegative()),
});
export type BackupDescriptor = z.infer<typeof backupDescriptor>;
const cell = z.discriminatedUnion('type', [
  z.strictObject({ type: z.literal('null'), value: z.null() }),
  z.strictObject({ type: z.literal('integer'), value: z.string().regex(/^-?\d+$/) }),
  z.strictObject({ type: z.literal('real'), value: z.number().finite() }),
  z.strictObject({ type: z.enum(['text', 'blob']), value: z.string() }),
]);
const record = z.strictObject({
  table: z.enum(tables),
  columns: z.array(z.string()),
  values: z.array(cell),
});
const part = z.strictObject({
  row: z.number().int().nonnegative(),
  part: z.number().int().nonnegative(),
  parts: z.number().int().positive().max(128),
  data: z.string(),
});
const quote = (name: string) => '"' + name.replaceAll('"', '""') + '"';
const initial = sha('acornary-native-household-v1');
const chain = (prior: string, ordinal: number, body: string) =>
  sha(prior + ':' + ordinal + ':' + sha(body));
const chunkBytes = 96 * 1024;

export class HouseholdBackup {
  constructor(private readonly db: NativeDatabase) {}
  private get sql() {
    return this.db.storage.sql;
  }
  private columns(table: string): string[] {
    return this.sql
      .exec<{ name: string }>(`PRAGMA table_info(${quote(table)})`)
      .toArray()
      .map((c) => c.name);
  }
  freeze(id: string): BackupDescriptor {
    z.string().uuid().parse(id);
    return this.db.transaction(() => {
      const prior = this.sql
        .exec<{ descriptor: string }>(
          "SELECT descriptor FROM cf_backup_sets WHERE id=? AND mode='SNAPSHOT'",
          id,
        )
        .toArray()[0];
      if (prior) return backupDescriptor.parse(JSON.parse(prior.descriptor));
      const state = this.db.query('SELECT * FROM cf_store_state WHERE singleton=1').rows[0];
      if (state?.status !== 'ACTIVE') throw new Error('Only an active household can be backed up');
      let ordinal = 0,
        rowNumber = 0,
        root = initial;
      const counts: Record<string, number> = {};
      for (const table of tables) {
        const columns = this.columns(table);
        const select = columns
          .map(
            (c, i) =>
              `typeof(${quote(c)}) AS t${i},CASE WHEN typeof(${quote(c)})='integer' THEN CAST(${quote(c)} AS TEXT) ELSE ${quote(c)} END AS v${i}`,
          )
          .join(',');
        counts[table] = 0;
        for (const row of this.sql.exec<Record<string, SqlStorageValue>>(
          `SELECT ${select} FROM ${quote(table)}${table === 'cf_outbox' ? " WHERE kind='DIRECTORY_CREATE'" : ''}`,
        )) {
          const values = columns.map((_, i) => ({
            type: row['t' + i],
            value:
              row['t' + i] === 'blob'
                ? Buffer.from(row['v' + i] as ArrayBuffer).toString('base64')
                : row['v' + i],
          }));
          const bytes = Buffer.from(JSON.stringify({ table, columns, values }));
          const parts = Math.ceil(bytes.length / chunkBytes);
          if (parts > 128) throw new Error('Backup row exceeds bounded record size');
          for (let p = 0; p < parts; p++) {
            const body = JSON.stringify({
              row: rowNumber,
              part: p,
              parts,
              data: bytes.subarray(p * chunkBytes, (p + 1) * chunkBytes).toString('base64'),
            });
            root = chain(root, ordinal, body);
            this.sql.exec('INSERT INTO cf_backup_chunks VALUES(?,?,?,?)', id, ordinal, body, root);
            ordinal++;
          }
          rowNumber++;
          counts[table]++;
        }
      }
      this.sql.exec(
        `INSERT INTO cf_backup_blobs SELECT ?,storage_key,file_size,sha256 FROM attachment_blobs UNION SELECT ?,thumbnail_key,NULL,NULL FROM attachment_blobs WHERE thumbnail_key IS NOT NULL`,
        id,
        id,
      );
      const descriptor: BackupDescriptor = {
        format: 'acornary-native-household-v1',
        id,
        household_id: state.household_id,
        schema: householdSchemaVersion,
        created_at: new Date().toISOString(),
        chunks: ordinal,
        root,
        counts,
      };
      this.sql.exec(
        "INSERT INTO cf_backup_sets VALUES(?,?,'SNAPSHOT',?,?)",
        id,
        JSON.stringify(descriptor),
        ordinal,
        root,
      );
      return descriptor;
    });
  }
  page(id: string, ordinal: number) {
    z.string().uuid().parse(id);
    z.number().int().nonnegative().parse(ordinal);
    return this.sql
      .exec<{ ordinal: number; body: string; digest: string }>(
        'SELECT ordinal,body,digest FROM cf_backup_chunks WHERE backup_id=? AND ordinal>=? ORDER BY ordinal LIMIT 4',
        id,
        ordinal,
      )
      .toArray();
  }
  release(id: string) {
    this.db.transaction(() => {
      if (
        !this.sql.exec("SELECT 1 FROM cf_backup_sets WHERE id=? AND mode='SNAPSHOT'", id).toArray()
          .length
      )
        throw new Error('Frozen backup not found');
      this.sql.exec('DELETE FROM cf_backup_chunks WHERE backup_id=?', id);
      this.sql.exec('DELETE FROM cf_backup_blobs WHERE backup_id=?', id);
      this.sql.exec('DELETE FROM cf_backup_sets WHERE id=?', id);
    });
  }
  beginRestore(input: unknown) {
    const d = backupDescriptor.parse(input);
    return this.db.transaction(() => {
      const prior = this.sql
        .exec<{ descriptor: string }>('SELECT descriptor FROM cf_backup_sets WHERE id=?', d.id)
        .toArray()[0];
      if (prior) {
        if (prior.descriptor !== JSON.stringify(d)) throw new Error('Restore descriptor changed');
        return;
      }
      if (
        this.sql.exec('SELECT 1 FROM cf_store_state').toArray().length ||
        this.sql.exec('SELECT 1 FROM households').toArray().length
      )
        throw new Error('Restore requires a new empty household');
      if (this.sql.exec('SELECT 1 FROM cf_backup_sets').toArray().length)
        throw new Error('Another restore is in progress');
      this.sql.exec(
        "INSERT INTO cf_backup_sets VALUES(?,?,'RESTORE',0,?)",
        d.id,
        JSON.stringify(d),
        initial,
      );
    });
  }
  restorePart(id: string, ordinal: number, body: string) {
    return this.db.transaction(() => {
      const state = this.sql
        .exec<{ descriptor: string; next_chunk: number; root: string; mode: string }>(
          'SELECT * FROM cf_backup_sets WHERE id=?',
          id,
        )
        .one();
      const d = backupDescriptor.parse(JSON.parse(state.descriptor));
      if (
        state.mode !== 'RESTORE' ||
        !Number.isSafeInteger(ordinal) ||
        ordinal < 0 ||
        ordinal >= d.chunks ||
        Buffer.byteLength(body) > 140 * 1024
      )
        throw new Error('Invalid restore part');
      part.parse(JSON.parse(body));
      if (ordinal < state.next_chunk) {
        if (
          this.sql
            .exec<{ body: string }>(
              'SELECT body FROM cf_backup_chunks WHERE backup_id=? AND ordinal=?',
              id,
              ordinal,
            )
            .one().body !== body
        )
          throw new Error('Restore replay differs');
        return;
      }
      if (ordinal !== state.next_chunk) throw new Error('Out of order restore');
      const root = chain(state.root, ordinal, body);
      this.sql.exec('INSERT INTO cf_backup_chunks VALUES(?,?,?,?)', id, ordinal, body, root);
      this.sql.exec(
        'UPDATE cf_backup_sets SET next_chunk=?,root=? WHERE id=?',
        ordinal + 1,
        root,
        id,
      );
    });
  }
  finishRestore(id: string) {
    return this.db.transaction(() => {
      const state = this.sql
        .exec<{ descriptor: string; next_chunk: number; root: string; mode: string }>(
          'SELECT * FROM cf_backup_sets WHERE id=?',
          id,
        )
        .one();
      const d = backupDescriptor.parse(JSON.parse(state.descriptor));
      if (state.mode === 'VALIDATED' || state.mode === 'RESTORED') return d;
      if (state.mode !== 'RESTORE' || state.next_chunk !== d.chunks || state.root !== d.root)
        throw new Error('Incomplete or corrupt restore');
      // All records are inserted in one transaction; self-referencing trees may arrive in any order.
      this.sql.exec('PRAGMA defer_foreign_keys=ON');
      this.sql.exec('DELETE FROM cf_directory_clock');
      let rowNumber = 0,
        fragments: Buffer[] = [],
        expectedParts = 0;
      const counts: Record<string, number> = Object.fromEntries(tables.map((t) => [t, 0]));
      for (const chunk of this.sql.exec<{ body: string }>(
        'SELECT body FROM cf_backup_chunks WHERE backup_id=? ORDER BY ordinal',
        id,
      )) {
        const p = part.parse(JSON.parse(chunk.body));
        if (
          p.row !== rowNumber ||
          p.part !== fragments.length ||
          (fragments.length && p.parts !== expectedParts)
        )
          throw new Error('Invalid restore record sequence');
        expectedParts = p.parts;
        fragments.push(Buffer.from(p.data, 'base64'));
        if (fragments.length !== expectedParts) continue;
        const r = record.parse(JSON.parse(Buffer.concat(fragments).toString('utf8')));
        const columns = this.columns(r.table);
        if (
          JSON.stringify(columns) !== JSON.stringify(r.columns) ||
          r.values.length !== columns.length
        )
          throw new Error('Restore schema differs');
        const placeholders = r.values
          .map((v) => (v.type === 'integer' ? 'CAST(? AS INTEGER)' : '?'))
          .join(',');
        this.sql.exec(
          `INSERT INTO ${quote(r.table)}(${columns.map(quote).join(',')}) VALUES(${placeholders})`,
          ...r.values.map((v) => (v.type === 'blob' ? Buffer.from(v.value, 'base64') : v.value)),
        );
        counts[r.table]++;
        rowNumber++;
        fragments = [];
      }
      if (
        fragments.length ||
        JSON.stringify(Object.keys(d.counts).sort()) !== JSON.stringify([...tables].sort()) ||
        tables.some((t) => counts[t] !== d.counts[t])
      )
        throw new Error('Restore row counts differ');
      const hh = this.sql.exec<{ id: string }>('SELECT id FROM households').toArray();
      if (
        hh.length !== 1 ||
        hh[0].id !== d.household_id ||
        this.sql.exec('PRAGMA foreign_key_check').toArray().length
      )
        throw new Error('Restore relationships differ');
      this.sql.exec(
        "INSERT INTO cf_store_state(singleton,household_id,schema_version,status,manifest_hash) VALUES(1,?,?,'IMPORTING',?)",
        d.household_id,
        d.schema,
        d.root,
      );
      this.sql.exec("UPDATE cf_backup_sets SET mode='VALIDATED' WHERE id=?", id);
      return d;
    });
  }
  frozenBlobs(id: string, after: string) {
    return this.sql
      .exec<{ storage_key: string; file_size: number | null; sha256: string | null }>(
        'SELECT storage_key,file_size,sha256 FROM cf_backup_blobs WHERE backup_id=? AND storage_key>? ORDER BY storage_key LIMIT 10',
        id,
        after,
      )
      .toArray();
  }
  blobPage(after: string) {
    return this.sql
      .exec<{ storage_key: string; file_size: number | null; sha256: string | null }>(
        `SELECT * FROM (SELECT storage_key,file_size,sha256 FROM attachment_blobs UNION SELECT thumbnail_key AS storage_key,NULL,NULL FROM attachment_blobs WHERE thumbnail_key IS NOT NULL) WHERE storage_key>? ORDER BY storage_key LIMIT 10`,
        after,
      )
      .toArray();
  }
  confirmBlob(key: string, bytes: number, digest: string) {
    if (
      !/^[a-f0-9]{64}$/.test(key) ||
      !Number.isInteger(bytes) ||
      bytes <= 0 ||
      !/^([a-f0-9]{64})$/.test(digest)
    )
      throw new Error('Invalid blob proof');
    this.sql.exec(
      'INSERT INTO cf_import_blob_checks VALUES(?,?,?) ON CONFLICT(storage_key) DO UPDATE SET byte_length=excluded.byte_length,sha256=excluded.sha256',
      key,
      bytes,
      digest,
    );
  }
  activate(id: string) {
    return this.db.transaction(() => {
      const state = this.sql
        .exec<{ descriptor: string; mode: string }>(
          'SELECT descriptor,mode FROM cf_backup_sets WHERE id=?',
          id,
        )
        .one();
      const d = backupDescriptor.parse(JSON.parse(state.descriptor));
      if (state.mode === 'RESTORED') return;
      if (state.mode !== 'VALIDATED') throw new Error('Restore is not validated');
      const missing = this.sql
        .exec(
          `SELECT 1 FROM attachment_blobs b LEFT JOIN cf_import_blob_checks c ON c.storage_key=b.storage_key LEFT JOIN cf_import_blob_checks t ON t.storage_key=b.thumbnail_key WHERE c.storage_key IS NULL OR c.byte_length<>b.file_size OR c.sha256<>b.sha256 OR (b.thumbnail_key IS NOT NULL AND t.storage_key IS NULL) LIMIT 1`,
        )
        .toArray();
      if (missing.length) throw new Error('Restored attachment bytes are not verified');
      this.sql.exec('UPDATE household_sync_state SET sync_generation=?', crypto.randomUUID());
      this.sql.exec("UPDATE cf_store_state SET status='ACTIVE' WHERE singleton=1");
      directoryEvent(this.db, 'restore:' + id, d.household_id);
      this.sql.exec("UPDATE cf_backup_sets SET mode='RESTORED' WHERE id=?", id);
    });
  }
}
