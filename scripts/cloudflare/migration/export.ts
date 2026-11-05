import type pg from 'pg';
import { createHash, randomUUID } from 'node:crypto';
import { mkdir, open, rename, unlink } from 'node:fs/promises';
import { join } from 'node:path';
import {
  sourceTables,
  includedTables,
  credentialTables,
  type Mode,
  type SnapshotManifest,
  validateManifest,
} from './format.js';
import { lines, regularFile } from './files.js';
import { verifySnapshot } from './verify.js';
const quote = (name: string) => '"' + name.replaceAll('"', '""') + '"';
const literal = (value: string) => "'" + value.replaceAll("'", "''") + "'";
export async function exportSnapshot(
  database: pg.Pool,
  options: {
    output: string;
    attachmentsRoot: string;
    sourceCommit: string;
    mode: Mode;
    onTable?: (table: string) => Promise<void>;
  },
) {
  if (!/^[a-f0-9]{40}$/.test(options.sourceCommit))
    throw new Error('Source commit must be a full SHA');
  if (!['preview', 'production'].includes(options.mode)) throw new Error('Invalid snapshot mode');
  const c = await database.connect();
  let completedManifest = false;
  try {
    await c.query('BEGIN ISOLATION LEVEL REPEATABLE READ READ ONLY');
    await c.query("SET LOCAL TIME ZONE 'UTC'");
    const tables = (
      await c.query("SELECT tablename FROM pg_tables WHERE schemaname='public' ORDER BY tablename")
    ).rows.map((r) => r.tablename as string);
    if (tables.join('|') !== sourceTables.join('|'))
      throw new Error(
        'Source schema differs from the reviewed baseline; classify missing/new tables before exporting',
      );
    const state = (await c.query('SELECT txid_current_snapshot()::text snapshot')).rows[0];
    const manifest: SnapshotManifest = {
      format: 'acornary-cloudflare-snapshot-v1',
      snapshot_id: randomUUID(),
      mode: options.mode,
      source_commit: options.sourceCommit,
      source_snapshot: state.snapshot,
      exported_at: new Date().toISOString(),
      tables: {},
      excluded: {},
      blobs: {},
    };
    // Exclusive directory creation prevents mixing a failed/old export with a new snapshot.
    await mkdir(options.output, { mode: 0o700 });
    await mkdir(join(options.output, 'tables'), { mode: 0o700 });
    await mkdir(join(options.output, 'blobs'), { mode: 0o700 });
    const included = new Set(includedTables(options.mode));
    for (const table of tables) {
      if (!included.has(table)) {
        const rows = Number(
          (await c.query(`SELECT count(*)::text count FROM public.${quote(table)}`)).rows[0].count,
        );
        manifest.excluded[table] = {
          rows,
          reason: credentialTables.includes(table as 'account' | 'passkey')
            ? 'preview_credentials'
            : 'transient',
        };
        continue;
      }
      const columns = (
        await c.query(
          `SELECT column_name FROM information_schema.columns
        WHERE table_schema='public' AND table_name=$1 AND udt_name IN ('int8','numeric') ORDER BY ordinal_position`,
          [table],
        )
      ).rows.map((r) => r.column_name as string);
      let expression = 'to_jsonb(t)';
      if (table === 'account')
        expression +=
          " - ARRAY['accessToken','refreshToken','idToken','accessTokenExpiresAt','refreshTokenExpiresAt']::text[]";
      for (const column of columns)
        expression += ` || jsonb_build_object(${literal(column)},t.${quote(column)}::text)`;
      const file = await open(join(options.output, 'tables', table + '.ndjson'), 'wx', 0o600);
      const hash = createHash('sha256');
      let rows = 0,
        bytes = 0;
      try {
        await c.query(
          `DECLARE migration_rows NO SCROLL CURSOR FOR SELECT (${expression})::text row FROM public.${quote(table)} t ORDER BY (${expression})::text COLLATE "C"`,
        );
        for (;;) {
          const batch = (await c.query('FETCH FORWARD 500 FROM migration_rows')).rows;
          if (!batch.length) break;
          for (const { row } of batch) {
            const line = row + '\n';
            await file.writeFile(line);
            hash.update(line);
            bytes += Buffer.byteLength(line);
            rows++;
          }
        }
        await c.query('CLOSE migration_rows');
        await file.sync();
      } finally {
        await file.close();
      }
      manifest.tables[table] = {
        rows,
        bytes,
        sha256: hash.digest('hex'),
        decimal_columns: columns,
      };
      await options.onTable?.(table);
    }
    // Blobs are immutable. A concurrent deletion/missing file aborts the package, never produces a valid manifest.
    for await (const line of lines(join(options.output, 'tables', 'attachment_blobs.ndjson'))) {
      const row = JSON.parse(line);
      for (const key of [row.storage_key, row.thumbnail_key].filter(Boolean)) {
        if (typeof key !== 'string' || !/^[a-f0-9]{64}$/.test(key))
          throw new Error('Invalid storage key');
        if (manifest.blobs[key]) continue;
        const source = await regularFile(join(options.attachmentsRoot, key + '.blob'));
        try {
          const size = (await source.stat()).size;
          if (size <= 0 || size > 25 * 1024 * 1024) throw new Error('Invalid blob size');
          const target = await open(join(options.output, 'blobs', key + '.blob'), 'wx', 0o600);
          const hash = createHash('sha256');
          let bytes = 0;
          try {
            for await (const chunk of source.createReadStream({ autoClose: false })) {
              await target.writeFile(chunk);
              hash.update(chunk);
              bytes += chunk.length;
            }
            await target.sync();
          } finally {
            await target.close();
          }
          manifest.blobs[key] = { bytes, sha256: hash.digest('hex') };
        } finally {
          await source.close();
        }
      }
    }
    validateManifest(manifest);
    await c.query('COMMIT');
    const file = await open(join(options.output, 'manifest.pending.json'), 'wx', 0o600);
    try {
      await file.writeFile(JSON.stringify(manifest, null, 2) + '\n');
      await file.sync();
    } finally {
      await file.close();
    }
    await rename(
      join(options.output, 'manifest.pending.json'),
      join(options.output, 'manifest.json'),
    );
    completedManifest = true;
    return await verifySnapshot(options.output);
  } catch (error) {
    await c.query('ROLLBACK').catch(() => {});
    if (completedManifest) await unlink(join(options.output, 'manifest.json'));
    throw error;
  } finally {
    c.release();
  }
}
