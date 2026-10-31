import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import pg from 'pg';
import { randomUUID } from 'node:crypto';
import { copyFile, mkdtemp, readFile, readdir, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { runMigrations } from '../../apps/server/src/migrate.js';

const id = (kind: string) => `${kind}_${randomUUID()}`;
const household = id('household'),
  actor = id('actor');
const otherHousehold = id('household'),
  otherActor = id('actor');
const item = id('item'),
  catalog = id('catalog_node'),
  note = id('note');
const historicalOperation = id('operation');
const url = process.env.DATABASE_URL;

describe.skipIf(!url)('Batch 1 operations on isolated PostgreSQL 18', () => {
  let admin: pg.Client;
  let pool: pg.Pool;
  let c: pg.PoolClient;
  let dir: string;
  let database: string;
  let role: string;
  let before: unknown[];
  let eventsBefore: unknown[];
  const snapshot = async () =>
    (
      await c.query(`SELECT idempotency_key,result::text,fingerprint,
    fingerprint_format,created_at::text FROM operations WHERE idempotency_key < 'legacy-1000'
    ORDER BY household_id,actor_id,idempotency_key`)
    ).rows;
  async function receipt(
    operation = id('operation'),
    key = randomUUID(),
    hh = household,
    who = actor,
    result: object = { operation_id: operation },
  ) {
    return c.query(
      'INSERT INTO operations(household_id,actor_id,idempotency_key,fingerprint,result) VALUES($1,$2,$3,$4,$5) RETURNING operation_id',
      [hh, who, key, 'opaque fingerprint', result],
    );
  }
  async function event(operation: string, changes: unknown = []) {
    return c.query(
      `INSERT INTO events(id,household_id,target_kind,target_id,operation_id,event_type,
      before_revision,after_revision,changes,actor_id,source,occurred_at)
      VALUES($1,$2,'ITEM',$3,$4,'EDIT',1,2,$5,$6,'TEST',now())`,
      [id('event'), household, item, operation, JSON.stringify(changes), actor],
    );
  }
  beforeAll(async () => {
    const target = new URL(url!);
    if (!target.pathname.includes('acornary_test'))
      throw new Error('Requires an isolated acornary_test database URL');
    admin = new pg.Client({ connectionString: target.toString() });
    await admin.connect();
    expect(
      Number((await admin.query('SHOW server_version_num')).rows[0].server_version_num),
    ).toBeGreaterThanOrEqual(180000);
    database = `acornary_test_ops_${randomUUID().replaceAll('-', '')}`;
    await admin.query(`CREATE DATABASE ${database}`);
    target.pathname = '/' + database;
    pool = new pg.Pool({
      connectionString: target.toString(),
      max: 2,
      statement_timeout: 0,
      idle_in_transaction_session_timeout: 0,
    });
    c = await pool.connect();
    dir = await mkdtemp(join(tmpdir(), 'acornary-ops-db-'));
    for (const name of (await readdir('migrations')).filter(
      (n) => /^00[1-8]_.*\.sql$/.test(n) || n === '011_sync_changes.sql',
    ))
      await copyFile(join('migrations', name), join(dir, name));
    // Exercise an actual old ledger row, not a synthesized checksum.
    await c.query(await readFile('migrations/001_initial.sql', 'utf8'));
    await c.query(
      'CREATE TABLE migrations(name text PRIMARY KEY, applied_at timestamptz DEFAULT now())',
    );
    await c.query("INSERT INTO migrations(name) VALUES('001_initial.sql')");
    await c.query("SET statement_timeout = '15s'; SET idle_in_transaction_session_timeout = '15s'");
    await runMigrations(c, dir);
    expect((await c.query('SHOW statement_timeout')).rows[0].statement_timeout).toBe('0');
    expect(
      (await c.query('SHOW idle_in_transaction_session_timeout')).rows[0]
        .idle_in_transaction_session_timeout,
    ).toBe('0');
    await c.query(
      "INSERT INTO households(id,name,timezone) VALUES($1,'one','UTC'),($2,'two','UTC')",
      [household, otherHousehold],
    );
    await c.query("INSERT INTO actors(id,household_id,name) VALUES($1,$2,'one'),($3,$4,'two')", [
      actor,
      household,
      otherActor,
      otherHousehold,
    ]);
    await c.query(
      "INSERT INTO catalog_nodes(id,household_id,kind,name) VALUES($1,$2,'SKU','fixture')",
      [catalog, household],
    );
    await c.query('INSERT INTO items(id,household_id,catalog_node_id) VALUES($1,$2,$3)', [
      item,
      household,
      catalog,
    ]);
    await c.query(
      "INSERT INTO notes(id,household_id,item_id,body,created_by) VALUES($1,$2,$3,'fixture',$4)",
      [note, household, item, actor],
    );
    await c.query(
      `INSERT INTO operations(household_id,actor_id,idempotency_key,fingerprint,result)
      SELECT $1,$2,'legacy-' || lpad(n::text,4,'0'),'fingerprint-' || n,
       CASE WHEN n=1000 THEN '{}'::jsonb ELSE jsonb_build_object('operation_id',
        CASE WHEN n=0 THEN $3 ELSE 'operation_' || gen_random_uuid()::text END) END
      FROM generate_series(0,1000) n`,
      [household, actor, historicalOperation],
    );
    await c.query(
      "UPDATE operations SET result=result || jsonb_build_object('old_payload',repeat('x',4194304)) WHERE idempotency_key='legacy-0000'",
    );
    await event(historicalOperation, 'x'.repeat(1048576));
    before = await snapshot();
    eventsBefore = (await c.query('SELECT row_to_json(e)::text AS row FROM events e ORDER BY id'))
      .rows;
  }, 60000);
  afterAll(async () => {
    if (c) {
      await c.query('ROLLBACK');
      await c.query('RESET ROLE');
      c.release();
    }
    await pool?.end();
    if (database) await admin.query(`DROP DATABASE ${database}`);
    if (role) await admin.query(`DROP ROLE ${role}`);
    await admin?.end();
    if (dir) await rm(dir, { recursive: true, force: true });
  }, 60000);

  it('OP05 OP06 OP07 OPS03 OPS04 resumes committed backfill batches, bridges old writes and preserves historical bytes', async () => {
    for (const name of (await readdir('migrations')).filter((n) => n.startsWith('009_')))
      await copyFile(join('migrations', name), join(dir, name));
    await expect(runMigrations(c, dir)).rejects.toThrow('Invalid historical operation identifier');
    const failed = (
      await c.query("SELECT * FROM migrations WHERE name='009_02_operation_backfill.sql'")
    ).rows[0];
    expect(failed).toMatchObject({ status: 'FAILED', attempt: 1, transactional: false });
    expect(failed.started_at).toBeInstanceOf(Date);
    expect(failed.finished_at).toBeInstanceOf(Date);
    expect(JSON.parse(failed.error).code).toBe('23514');
    expect(failed.checkpoint.last).toEqual([household, actor, 'legacy-0999']);
    expect(failed.checkpoint.upper).toEqual([household, actor, 'legacy-1000']);
    expect(
      (await c.query('SELECT count(*) FROM operations WHERE operation_id IS NOT NULL')).rows[0]
        .count,
    ).toBe('1000');
    // A separate application connection can insert through the committed bridge
    // while the remaining migration is failed. This key is behind the checkpoint.
    const writer = await pool.connect();
    const bridged = id('operation');
    try {
      const inserted = await writer.query(
        `INSERT INTO operations(household_id,actor_id,idempotency_key,fingerprint,result)
        VALUES($1,$2,'aaa-new','new-fingerprint',$3) RETURNING operation_id`,
        [household, actor, { operation_id: bridged }],
      );
      expect(inserted.rows[0].operation_id).toBe(bridged);
    } finally {
      writer.release();
    }
    await c.query("UPDATE operations SET result=$1 WHERE idempotency_key='legacy-1000'", [
      { operation_id: id('operation') },
    ]);
    await runMigrations(c, dir);
    expect(
      (
        await c.query(
          "SELECT status,attempt FROM migrations WHERE name='009_02_operation_backfill.sql'",
        )
      ).rows[0],
    ).toEqual({ status: 'APPLIED', attempt: 2 });
    expect(
      (
        await c.query(
          "SELECT operation_id,fingerprint FROM operations WHERE idempotency_key='aaa-new'",
        )
      ).rows[0],
    ).toEqual({ operation_id: bridged, fingerprint: 'new-fingerprint' });
    // The sole fixture repair is excluded from the historical digest comparison.
    expect((await snapshot()).filter((r: any) => r.idempotency_key !== 'aaa-new')).toEqual(before);
    expect(
      (await c.query('SELECT row_to_json(e)::text AS row FROM events e ORDER BY id')).rows,
    ).toEqual(eventsBefore);
    await expect(
      c.query("UPDATE operations SET fingerprint='changed' WHERE idempotency_key='legacy-0000'"),
    ).rejects.toThrow('append-only');
    await expect(
      c.query("DELETE FROM operations WHERE idempotency_key='legacy-0000'"),
    ).rejects.toThrow('append-only');
    await expect(c.query('DELETE FROM events')).rejects.toThrow('append-only');
  }, 60000);

  it('OPS01 preserves UNVERIFIED history and rejects drift without executing new SQL', async () => {
    expect(
      (await c.query("SELECT status,checksum,attempt FROM migrations WHERE name='001_initial.sql'"))
        .rows[0],
    ).toEqual({ status: 'UNVERIFIED', checksum: null, attempt: 0 });
    const name = '009_01_operation_expand.sql';
    const original = await readFile(join(dir, name), 'utf8');
    await writeFile(join(dir, name), original + '\n-- drift\n');
    try {
      await expect(runMigrations(c, dir)).rejects.toThrow('checksum drift');
    } finally {
      await writeFile(join(dir, name), original);
    }
  });

  it('OP01 commits an event inserted before its receipt', async () => {
    const operation = id('operation');
    await c.query('BEGIN');
    await event(operation);
    await receipt(operation);
    await c.query('COMMIT');
    expect(
      (await c.query('SELECT count(*) FROM events WHERE operation_id=$1', [operation])).rows[0]
        .count,
    ).toBe('1');
  });
  it('OP02 rejects a missing receipt at COMMIT and rolls back the event', async () => {
    const operation = id('operation');
    await c.query('BEGIN');
    await event(operation);
    await expect(c.query('COMMIT')).rejects.toMatchObject({ code: '23503' });
    await c.query('ROLLBACK');
    expect(
      (await c.query('SELECT count(*) FROM events WHERE operation_id=$1', [operation])).rows[0]
        .count,
    ).toBe('0');
  });
  it('OP03 rejects duplicate operation IDs in a household, allowing the same ID in another', async () => {
    const operation = id('operation');
    await receipt(operation);
    await expect(receipt(operation)).rejects.toMatchObject({
      code: '23505',
      constraint: 'operations_household_operation_unique',
    });
    await receipt(operation, randomUUID(), otherHousehold, otherActor);
  });
  it('OP04 rejects a cross-household event reference at COMMIT', async () => {
    const operation = id('operation');
    await receipt(operation, randomUUID(), otherHousehold, otherActor);
    await c.query('BEGIN');
    await event(operation);
    await expect(c.query('COMMIT')).rejects.toMatchObject({ code: '23503' });
    await c.query('ROLLBACK');
  });
  it('rejects absent/null/non-string/malformed/mismatched IDs and accepts matching explicit IDs', async () => {
    for (const result of [{}, { operation_id: null }, { operation_id: 1 }, { operation_id: 'bad' }])
      await expect(
        receipt(undefined, undefined, undefined, undefined, result),
      ).rejects.toMatchObject({ code: '23514' });
    const operation = id('operation');
    const insert = (column: string) =>
      c.query(
        `INSERT INTO operations(household_id,actor_id,idempotency_key,fingerprint,result,operation_id)
      VALUES($1,$2,$3,'fixture',$4,$5)`,
        [household, actor, randomUUID(), { operation_id: operation }, column],
      );
    await expect(insert(id('operation'))).rejects.toMatchObject({ code: '23514' });
    await insert(operation);
  });
  it('guards serialized UTF-8 JSON size for new inserts only, including exact boundaries', async () => {
    const operation = id('operation');
    const base = { operation_id: operation, padding: '' };
    const resultBytes = Number(
      (await c.query('SELECT octet_length($1::jsonb::text) AS bytes', [base])).rows[0].bytes,
    );
    await receipt(operation, undefined, undefined, undefined, {
      ...base,
      padding: 'x'.repeat(4194304 - resultBytes),
    });
    await expect(
      receipt(undefined, undefined, undefined, undefined, {
        operation_id: id('operation'),
        padding: 'x'.repeat(4194305 - resultBytes),
      }),
    ).rejects.toMatchObject({ code: '23514' });
    await event(operation, 'x'.repeat(1048574)); // JSON quotes consume two bytes.
    await expect(event(operation, 'x'.repeat(1048575))).rejects.toMatchObject({ code: '23514' });
    await expect(event(operation, '界'.repeat(400000))).rejects.toMatchObject({ code: '23514' });
  });

  it('OPS02 cleans only the failed concurrent index, then retries successfully', async () => {
    const name = '999_ops_index_test.sql';
    await c.query('CREATE TABLE ops_index_fixture(value integer)');
    await c.query('INSERT INTO ops_index_fixture VALUES(1),(1)');
    // Leave an unrelated invalid index to prove that recovery does not sweep it.
    await expect(
      c.query('CREATE UNIQUE INDEX CONCURRENTLY unrelated_ops_idx ON ops_index_fixture(value)'),
    ).rejects.toMatchObject({ code: '23505' });
    await writeFile(
      join(dir, name),
      '-- acornary:no-transaction\nCREATE UNIQUE INDEX CONCURRENTLY owned_ops_idx ON public.ops_index_fixture (value);',
    );
    await expect(runMigrations(c, dir)).rejects.toMatchObject({ code: '23505' });
    expect(
      (await c.query("SELECT to_regclass('owned_ops_idx') AS owned")).rows[0].owned,
    ).toBeNull();
    expect(
      (
        await c.query(
          "SELECT indisvalid FROM pg_index WHERE indexrelid='unrelated_ops_idx'::regclass",
        )
      ).rows[0].indisvalid,
    ).toBe(false);
    await c.query(
      'DELETE FROM ops_index_fixture WHERE ctid IN (SELECT ctid FROM ops_index_fixture LIMIT 1)',
    );
    await runMigrations(c, dir);
    expect(
      (await c.query('SELECT status,attempt,transactional FROM migrations WHERE name=$1', [name]))
        .rows[0],
    ).toEqual({ status: 'APPLIED', attempt: 2, transactional: false });
    const oid = (await c.query("SELECT 'owned_ops_idx'::regclass::oid AS oid")).rows[0].oid;
    await c.query("UPDATE migrations SET status='STARTED' WHERE name=$1", [name]);
    await runMigrations(c, dir);
    expect((await c.query("SELECT 'owned_ops_idx'::regclass::oid AS oid")).rows[0].oid).toBe(oid);
  });

  it('OPS04 rolls back ordinary failed migration DDL while preserving compatible writes', async () => {
    const name = '999_ops_transaction_failure.sql';
    await writeFile(join(dir, name), 'CREATE TABLE ops_rolled_back(value integer); SELECT 1/0;');
    try {
      await expect(runMigrations(c, dir)).rejects.toMatchObject({ code: '22012' });
      expect(
        (await c.query("SELECT to_regclass('ops_rolled_back') AS relation")).rows[0].relation,
      ).toBeNull();
      expect(
        (await c.query('SELECT status,applied_at FROM migrations WHERE name=$1', [name])).rows[0],
      ).toEqual({ status: 'FAILED', applied_at: null });
      await receipt();
    } finally {
      await rm(join(dir, name));
    }
  });

  it('revokes stale runtime grants while preserving application writes and barcode deletes', async () => {
    const testRole = 'acornary_ops_' + randomUUID().replaceAll('-', '');
    await admin.query(`CREATE ROLE ${testRole}`);
    role = testRole;
    await c.query(
      `GRANT UPDATE,DELETE ON operations TO ${role}; GRANT DELETE ON items,catalog_nodes,notes TO ${role}`,
    );
    await c.query((await readFile('deploy/grants.sql', 'utf8')).replaceAll('acornary_app', role));
    await c.query(`SET ROLE ${role}`);
    try {
      for (const table of ['operations', 'items', 'catalog_nodes', 'notes'])
        await expect(c.query(`DELETE FROM ${table} WHERE false`)).rejects.toMatchObject({
          code: '42501',
        });
      await expect(
        c.query('UPDATE operations SET fingerprint=fingerprint WHERE false'),
      ).rejects.toMatchObject({ code: '42501' });
      await receipt();
      await c.query('UPDATE items SET display_name=$1 WHERE id=$2', ['runtime write', item]);
      await c.query('UPDATE catalog_nodes SET name=$1 WHERE id=$2', ['runtime write', catalog]);
      await c.query('UPDATE notes SET body=$1 WHERE id=$2', ['runtime write', note]);
      await c.query("INSERT INTO barcode_index VALUES($1,'ops-test',$2)", [household, catalog]);
      expect((await c.query("DELETE FROM barcode_index WHERE barcode='ops-test'")).rowCount).toBe(
        1,
      );
    } finally {
      await c.query('RESET ROLE');
    }
  });
});
