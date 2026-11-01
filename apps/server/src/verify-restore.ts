import pg from 'pg';
import { createHash } from 'node:crypto';
import { readFile, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { pool } from './db.js';

// pg_dump already includes all public tables. This minimum inventory prevents a
// partial/old restore from passing merely because both sides omitted new tables.
export const backupRequiredTables = [
  'households',
  'actors',
  'catalog_nodes',
  'items',
  'attribute_templates',
  'notes',
  'events',
  'operations',
  'barcode_index',
  'installations',
  'household_settings',
  'migrations',
  'catalog_policy_versions',
  'catalog_proposals',
  'catalog_identity_keys',
  'date_facts',
  'household_sync_state',
  'sync_changes',
  'sync_object_versions',
  'label_projection_checkpoint',
  'attachments',
  'attachment_blobs',
  'upload_sessions',
  'sensitive_access_audit',
  'item_splits',
  'attribute_references',
] as const;
export type BackupManifest = {
  format: 1;
  tables: Record<string, { count: number; sha256: string }>;
  attachment_bytes: 'NOT_VERIFIED';
};
export function assertBackupCoverage(manifest: BackupManifest) {
  if (
    manifest.format !== 1 ||
    !manifest.tables ||
    backupRequiredTables.some((table) => !manifest.tables[table]) ||
    Object.values(manifest.tables).some(
      (row) =>
        !Number.isSafeInteger(row.count) || row.count < 0 || !/^[a-f0-9]{64}$/.test(row.sha256),
    )
  )
    throw new Error('Incomplete or invalid backup manifest');
}
export async function snapshot(
  database: pg.Pool,
  exportedSnapshot?: string,
): Promise<BackupManifest> {
  if (exportedSnapshot && !/^[0-9A-Fa-f]+-[0-9A-Fa-f]+-[0-9]+$/.test(exportedSnapshot))
    throw new Error('Invalid exported PostgreSQL snapshot');
  const c = await database.connect();
  try {
    await c.query('BEGIN ISOLATION LEVEL REPEATABLE READ READ ONLY');
    // PostgreSQL SET TRANSACTION SNAPSHOT does not accept bind parameters.
    if (exportedSnapshot) await c.query(`SET TRANSACTION SNAPSHOT '${exportedSnapshot}'`);
    const tables = (
      await c.query("SELECT tablename FROM pg_tables WHERE schemaname='public' ORDER BY tablename")
    ).rows;
    const result: BackupManifest = { format: 1, tables: {}, attachment_bytes: 'NOT_VERIFIED' };
    for (const { tablename } of tables) {
      const quoted = '"' + tablename.replaceAll('"', '""') + '"';
      const rows = (await c.query(`SELECT to_jsonb(t)::text AS row FROM ${quoted} t`)).rows
        .map((r) => r.row)
        .sort();
      result.tables[tablename] = {
        count: rows.length,
        sha256: createHash('sha256').update(JSON.stringify(rows)).digest('hex'),
      };
    }
    assertBackupCoverage(result);
    await c.query('COMMIT');
    return result;
  } catch (error) {
    await c.query('ROLLBACK');
    throw error;
  } finally {
    c.release();
  }
}
export function compareRestore(source: BackupManifest, target: BackupManifest) {
  assertBackupCoverage(source);
  assertBackupCoverage(target);
  const changed = [
    ...new Set([...Object.keys(source.tables), ...Object.keys(target.tables)]),
  ].filter(
    (table) =>
      source.tables[table]?.count !== target.tables[table]?.count ||
      source.tables[table]?.sha256 !== target.tables[table]?.sha256,
  );
  if (changed.length)
    throw new Error(
      `Restore differs in: ${changed.join(', ')}. Keep the restored database for diagnosis.`,
    );
  return {
    tables_compared: Object.keys(source.tables).length,
    identical: true,
    attachment_bytes: 'NOT_VERIFIED' as const,
  };
}
export async function resetRestoredSync(database: pg.Pool) {
  const c = await database.connect();
  try {
    await c.query('BEGIN');
    const households = (await c.query('SELECT id FROM households ORDER BY id')).rows;
    for (const row of households) await c.query('SELECT reset_household_sync($1)', [row.id]);
    await c.query('COMMIT');
    return households.length;
  } catch (error) {
    await c.query('ROLLBACK');
    throw error;
  } finally {
    c.release();
  }
}
async function main() {
  const args = process.argv.slice(2);
  const option = (key: string) => (args.includes(key) ? args[args.indexOf(key) + 1] : undefined);
  const manifestPath = option('--write-manifest');
  if (manifestPath) {
    if (!option('--snapshot'))
      throw new Error(
        'Backup manifest requires the exported snapshot also passed to pg_dump --snapshot.',
      );
    try {
      await writeFile(
        manifestPath,
        JSON.stringify(await snapshot(pool, option('--snapshot')), null, 2) + '\n',
        { mode: 0o600, flag: 'wx' },
      );
    } finally {
      await pool.end();
    }
    return;
  }
  const name = args[0];
  if (!/^acornary_restore_[0-9]+$/.test(name ?? ''))
    throw new Error('Verification requires an independent acornary_restore_<timestamp> database.');
  const url = new URL(process.env.DATABASE_URL!);
  if (url.pathname === `/${name}`) throw new Error('Source and restored database must differ.');
  // Preserve the existing deployment/CI invocation. Without a saved manifest,
  // this remains a local comparison requiring a quiescent source, not backup evidence.
  url.pathname = `/${name}`;
  const restored = new pg.Pool({ connectionString: url.toString(), max: 1 });
  try {
    const source = option('--manifest')
      ? JSON.parse(await readFile(option('--manifest')!, 'utf8'))
      : await snapshot(pool);
    const result = compareRestore(source, await snapshot(restored));
    // Run only after digest comparison. Old bootstrap/catch-up cursors then fail
    // through the existing generation checks; no export sessions exist yet.
    const reset = args.includes('--reset-sync') ? await resetRestoredSync(restored) : undefined;
    console.log(
      JSON.stringify({
        restored_database: name,
        ...result,
        comparison_basis: option('--manifest') ? 'backup_manifest' : 'quiescent_source_required',
        sync_households_reset: reset,
      }),
    );
  } finally {
    await pool.end();
    await restored.end();
  }
}
if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) await main();
