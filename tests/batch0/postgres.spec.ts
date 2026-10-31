import { beforeAll, afterAll, beforeEach, afterEach, describe, it, expect } from 'vitest';
import { readFile } from 'node:fs/promises';
import { randomUUID } from 'node:crypto';
import pg from 'pg';
import { validateAuditUrl, auditSnapshot } from '../../scripts/batch0/audit-model.js';
import { readAuditSnapshot } from '../../scripts/batch0/audit.js';

const raw = process.env.BATCH0_TEST_DATABASE_URL ?? '';
validateAuditUrl(raw); // Explicit opt-in config; no fallback to DATABASE_URL.
const schema = 'batch0_' + randomUUID().replaceAll('-', '');
const make = () =>
  new pg.Client({ connectionString: raw, connectionTimeoutMillis: 5000, statement_timeout: 10000 });
const a = make(),
  b = make(),
  observer = make();
let bPid: number;
beforeAll(async () => {
  for (const c of [a, b, observer]) await c.connect();
  await a.query(`CREATE SCHEMA ${schema}`);
  for (const c of [a, b, observer]) await c.query(`SET search_path TO ${schema},pg_catalog`);
  await a.query(await readFile('tests/batch0/reference.sql', 'utf8'));
  bPid = (await b.query('SELECT pg_backend_pid() AS pid')).rows[0].pid;
});
beforeEach(async () => {
  await a.query('TRUNCATE events,operations,nodes,sync_changes,sync_state RESTART IDENTITY');
  await a.query("INSERT INTO nodes(id,household_id) VALUES('a','hh'),('b','hh')");
});
afterEach(async () => {
  await observer.query('SELECT pg_cancel_backend($1)', [bPid]);
  await b.query('ROLLBACK');
  await a.query('ROLLBACK');
});
afterAll(async () => {
  try {
    await observer.query(`DROP SCHEMA IF EXISTS ${schema} CASCADE`);
  } finally {
    for (const c of [a, b, observer]) await c.end();
  }
});
async function waitForAdvisoryWait() {
  const deadline = Date.now() + 5000;
  while (Date.now() < deadline) {
    const result = await observer.query(
      "SELECT 1 FROM pg_locks WHERE pid=$1 AND locktype='advisory' AND NOT granted",
      [bPid],
    );
    if (result.rowCount) return;
    await new Promise((r) => setTimeout(r, 10)); // Poll the actual lock barrier, not guessed operation timing.
  }
  throw new Error('Second session did not reach the advisory-lock barrier.');
}
const settled = (promise: Promise<any>) =>
  promise.then(
    () => ({ ok: true, message: '' }),
    (e) => ({ ok: false, message: String(e.message), code: e.code }),
  );

describe('PostgreSQL 18 reference mechanics — not production repair acceptance', () => {
  it('permits events before the operation and rejects a missing operation on COMMIT', async () => {
    await a.query('BEGIN');
    await a.query("INSERT INTO events VALUES('e','h','op')");
    await a.query(`INSERT INTO operations VALUES('h','op','{"operation_id":"op"}')`);
    await a.query('COMMIT');
    await a.query('BEGIN');
    await a.query("INSERT INTO events VALUES('missing','h','absent')");
    await expect(a.query('COMMIT')).rejects.toMatchObject({ code: '23503' });
    expect((await observer.query("SELECT 1 FROM events WHERE id='missing'")).rowCount).toBe(0);
  });
  it('rejects duplicate and cross-household operation references', async () => {
    await a.query(`INSERT INTO operations VALUES('h','op','{"operation_id":"op"}')`);
    await expect(
      a.query(`INSERT INTO operations VALUES('h','op','{"operation_id":"op"}')`),
    ).rejects.toMatchObject({ code: '23505' });
    await a.query('BEGIN');
    await a.query("INSERT INTO events VALUES('cross','other','op')");
    await expect(a.query('COMMIT')).rejects.toMatchObject({ code: '23503' });
  });
  it('rejects missing, JSON null and inconsistent receipt operation IDs', async () => {
    for (const result of [
      {},
      { operation_id: null },
      { operation_id: 7 },
      { operation_id: 'different' },
    ])
      await expect(
        a.query('INSERT INTO operations VALUES($1,$2,$3)', ['h', 'op', result]),
      ).rejects.toMatchObject({ code: '23514' });
  });
  it('serializes opposite parent writes and sees the committed edge after waiting', async () => {
    await a.query('BEGIN');
    await a.query("UPDATE nodes SET parent_id='b' WHERE id='a'");
    await b.query('BEGIN');
    const pending = settled(b.query("UPDATE nodes SET parent_id='a' WHERE id='b'"));
    await waitForAdvisoryWait();
    await a.query('COMMIT');
    expect(await pending).toMatchObject({ ok: false, message: 'CYCLE_DETECTED' });
    await b.query('ROLLBACK');
    expect((await observer.query('SELECT id,parent_id FROM nodes ORDER BY id')).rows).toEqual([
      { id: 'a', parent_id: 'b' },
      { id: 'b', parent_id: null },
    ]);
  });
  it('serializes a move against removing container capability', async () => {
    await a.query('BEGIN');
    await a.query("UPDATE nodes SET parent_id='b' WHERE id='a'");
    await b.query('BEGIN');
    const pending = settled(b.query("UPDATE nodes SET can_contain=false WHERE id='b'"));
    await waitForAdvisoryWait();
    await a.query('COMMIT');
    expect(await pending).toMatchObject({ ok: false, message: 'TEMPLATE_IN_USE' });
  });
  it('rejects REPEATABLE READ tree mutation and rolls back a failed transaction', async () => {
    await a.query('BEGIN ISOLATION LEVEL REPEATABLE READ');
    await expect(a.query("UPDATE nodes SET parent_id='b' WHERE id='a'")).rejects.toThrow(
      'UNSUPPORTED_WRITE_ISOLATION',
    );
    await a.query('ROLLBACK');
    expect(
      (await a.query("SELECT parent_id FROM nodes WHERE id='a'")).rows[0].parent_id,
    ).toBeNull();
  });
  it('rejects identity updates and releases a household lock after rollback', async () => {
    await expect(a.query("UPDATE nodes SET household_id='other' WHERE id='a'")).rejects.toThrow(
      'IMMUTABLE_IDENTITY',
    );
    await expect(a.query("UPDATE nodes SET id='new' WHERE id='a'")).rejects.toThrow(
      'IMMUTABLE_IDENTITY',
    );
    await a.query('BEGIN');
    await a.query("UPDATE nodes SET parent_id='b' WHERE id='a'");
    await b.query('BEGIN');
    const pending = settled(b.query("UPDATE nodes SET parent_id='a' WHERE id='b'"));
    await waitForAdvisoryWait();
    await a.query('ROLLBACK');
    expect(await pending).toMatchObject({ ok: true });
    await b.query('COMMIT');
    expect((await observer.query('SELECT id,parent_id FROM nodes ORDER BY id')).rows).toEqual([
      { id: 'a', parent_id: null },
      { id: 'b', parent_id: 'a' },
    ]);
  });
  it('demonstrates why a committed global maximum is not a household watermark', async () => {
    await a.query("INSERT INTO sync_state(household_id) VALUES('A'),('B')");
    await a.query('BEGIN');
    await a.query("SELECT pg_advisory_xact_lock(hashtextextended('A',0))");
    const older = (
      await a.query(
        "INSERT INTO sync_changes(household_id,object_id) VALUES('A','first') RETURNING change_id",
      )
    ).rows[0].change_id;
    await a.query("UPDATE sync_state SET watermark=$1 WHERE household_id='A'", [older]);
    await b.query('BEGIN');
    await b.query("SELECT pg_advisory_xact_lock(hashtextextended('B',0))");
    const newer = (
      await b.query(
        "INSERT INTO sync_changes(household_id,object_id) VALUES('B','second') RETURNING change_id",
      )
    ).rows[0].change_id;
    await b.query("UPDATE sync_state SET watermark=$1 WHERE household_id='B'", [newer]);
    await b.query('COMMIT');
    expect(BigInt(newer) > BigInt(older)).toBe(true);
    expect(
      (await observer.query('SELECT max(change_id)::text AS n FROM sync_changes')).rows[0].n,
    ).toBe(newer);
    expect(
      (await observer.query("SELECT watermark FROM sync_state WHERE household_id='A'")).rows[0]
        .watermark,
    ).toBe('0');
    await a.query('COMMIT');
    expect(
      (
        await observer.query(
          "SELECT change_id FROM sync_changes WHERE household_id='A' AND change_id>0",
        )
      ).rows[0].change_id,
    ).toBe(older);
  });
  it('audits the seeded current-schema database in a READ ONLY transaction', async () => {
    const c = make();
    await c.connect();
    try {
      await c.query('BEGIN ISOLATION LEVEL REPEATABLE READ READ ONLY');
      const s = await readAuditSnapshot(c),
        report = auditSnapshot(s);
      expect(report.errors).toBe(0);
      expect(s.items.length).toBeGreaterThanOrEqual(40);
      await expect(c.query("UPDATE households SET name='must fail'")).rejects.toMatchObject({
        code: '25006',
      });
      await c.query('ROLLBACK');
    } finally {
      await c.end();
    }
  });
});
