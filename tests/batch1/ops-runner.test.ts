import { afterEach, describe, expect, it, vi } from 'vitest';
import { createHash } from 'node:crypto';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { runMigrations } from '../../apps/server/src/migrate.js';
import { createMigrationPool, pool, type Client } from '../../apps/server/src/db.js';

const dirs: string[] = [];
async function files(entries: Record<string, string>) {
  const dir = await mkdtemp(join(tmpdir(), 'acornary-ops-runner-'));
  dirs.push(dir);
  await Promise.all(Object.entries(entries).map(([name, sql]) => writeFile(join(dir, name), sql)));
  return dir;
}
afterEach(async () => {
  await Promise.all(dirs.splice(0).map((dir) => rm(dir, { recursive: true })));
});
const hash = (sql: string) => createHash('sha256').update(sql).digest('hex');
function client(
  history: object[] = [],
  respond?: (sql: string, values: unknown[]) => object[] | undefined,
) {
  const query = vi.fn(async (sql: string, values: unknown[] = []) => ({
    rows: respond?.(sql, values) ?? (sql === 'SELECT * FROM migrations' ? history : []),
    rowCount: 1,
  }));
  return {
    c: { query } as unknown as Client,
    query,
    statements: () => query.mock.calls.map(([sql]) => sql),
  };
}
const indexSQL =
  '-- acornary:no-transaction\nCREATE UNIQUE INDEX CONCURRENTLY test_idx ON public.operations (household_id, operation_id);';
const definition =
  'CREATE UNIQUE INDEX test_idx ON public.operations USING btree (household_id, operation_id)';

describe('Batch 1 migration runner (no database)', () => {
  it('OPS01 leaves legacy rows UNVERIFIED without assigning a present-day hash', async () => {
    const dir = await files({ '001_old.sql': 'SELECT 42;' });
    const db = client([{ name: '001_old.sql', status: 'UNVERIFIED', checksum: null }]);
    await runMigrations(db.c, dir);
    expect(db.statements().join('\n')).toContain("DEFAULT 'UNVERIFIED'");
    expect(db.statements()).not.toContain('SELECT 42;');
    expect(db.statements().some((s) => s.startsWith('INSERT INTO migrations'))).toBe(false);
  });

  it('attests old receipts only with matching trusted release evidence, without replaying SQL', async () => {
    const sql = 'SELECT 42;';
    const dir = await files({ '001_old.sql': sql });
    const db = client([{ name: '001_old.sql', status: 'UNVERIFIED', checksum: null }]);
    await runMigrations(db.c, dir, false, { '001_old.sql': hash(sql) });
    expect(db.statements()).not.toContain(sql);
    const update = db.query.mock.calls.find(([s]) => s.includes('SET checksum=$2'));
    expect(update?.[1]).toEqual([
      '001_old.sql',
      hash(sql),
      true,
      { legacy_verified_from: 'previous_release_manifest' },
    ]);
  });

  it.each<Record<string, string>>([{}, { '001_old.sql': '0'.repeat(64) }])(
    'rejects missing or changed legacy evidence before new SQL',
    async (manifest) => {
      const dir = await files({ '001_old.sql': 'SELECT 42;', '002_new.sql': 'SELECT 43;' });
      const db = client([{ name: '001_old.sql', status: 'UNVERIFIED', checksum: null }]);
      await expect(runMigrations(db.c, dir, false, manifest)).rejects.toThrow(
        'Untrusted legacy migration',
      );
      expect(db.statements()).not.toContain('SELECT 43;');
      expect(db.statements().some((s) => s.includes('SET checksum=$2'))).toBe(false);
    },
  );

  it.each(['APPLIED', 'FAILED', 'STARTED'])(
    'OPS01 rejects checksum drift in %s before running any file',
    async (status) => {
      const dir = await files({ '001_new.sql': 'SELECT 1;', '002_changed.sql': 'SELECT 2;' });
      const db = client([{ name: '002_changed.sql', status, checksum: hash('SELECT old;') }]);
      await expect(runMigrations(db.c, dir)).rejects.toThrow('checksum drift: 002_changed.sql');
      expect(db.statements()).not.toContain('SELECT 1;');
      expect(db.statements().at(-1)).toContain('pg_advisory_unlock');
    },
  );

  it('commits SQL and APPLIED together after a durable STARTED record', async () => {
    const dir = await files({ '001_new.sql': 'SELECT 1;' });
    const db = client();
    await runMigrations(db.c, dir);
    const sql = db.statements();
    const start = sql.findIndex((s) => s.startsWith('INSERT INTO migrations'));
    expect(db.query.mock.calls[start][1]).toEqual(['001_new.sql', hash('SELECT 1;'), true, null]);
    expect(sql.indexOf('BEGIN')).toBeGreaterThan(start);
    expect(sql.indexOf('SELECT 1;')).toBeGreaterThan(sql.indexOf('BEGIN'));
    expect(sql.findIndex((s) => s.includes("status='APPLIED'"))).toBeLessThan(
      sql.indexOf('COMMIT'),
    );
    expect(sql[0]).toBe('SET statement_timeout = 0');
    expect(sql[1]).toBe('SET idle_in_transaction_session_timeout = 0');
    expect(sql[2]).toContain('pg_advisory_lock(');
  });

  it('OPS04 rolls back failed SQL and records FAILED with code after rollback', async () => {
    const dir = await files({ '001_fail.sql': 'SELECT broken;' });
    const failure = Object.assign(new Error('fixture failure'), { code: '42601' });
    const db = client([], (sql) => {
      if (sql === 'SELECT broken;') throw failure;
    });
    await expect(runMigrations(db.c, dir)).rejects.toBe(failure);
    const sql = db.statements();
    const failed = sql.findIndex((s) => s.includes("status='FAILED'"));
    expect(failed).toBeGreaterThan(sql.indexOf('ROLLBACK'));
    expect(JSON.parse(db.query.mock.calls[failed][1]![1] as string)).toEqual({
      code: '42601',
      message: 'fixture failure',
    });
    expect(sql).not.toContain('COMMIT');
    expect(sql.at(-1)).toContain('pg_advisory_unlock');
  });

  it('OPS02 executes a nontransactional file without BEGIN and cleans only its matching invalid index', async () => {
    const dir = await files({ '001_index.sql': indexSQL });
    let exists = false;
    const db = client([], (sql, values) => {
      if (sql === indexSQL) {
        exists = true;
        throw Object.assign(new Error('duplicate'), { code: '23505' });
      }
      if (sql.includes('pg_get_indexdef')) {
        expect(values).toEqual(['test_idx']);
        return exists ? [{ indisvalid: false, definition }] : [];
      }
    });
    await expect(runMigrations(db.c, dir)).rejects.toThrow('duplicate');
    expect(db.statements()).not.toContain('BEGIN');
    expect(db.statements().filter((s) => s.startsWith('DROP INDEX'))).toEqual([
      'DROP INDEX CONCURRENTLY public.test_idx',
    ]);
  });

  it.each([true, false])(
    'OPS02 refuses a pre-existing unowned index (valid=%s)',
    async (indisvalid) => {
      const dir = await files({ '001_index.sql': indexSQL });
      const db = client([], (sql) =>
        sql.includes('pg_get_indexdef') ? [{ indisvalid, definition }] : undefined,
      );
      await expect(runMigrations(db.c, dir)).rejects.toThrow('outside this migration');
      expect(db.statements()).not.toContain(indexSQL);
      expect(db.statements().some((s) => s.startsWith('DROP INDEX'))).toBe(false);
    },
  );

  it('OPS02 adopts a valid index from an interrupted attempt without dropping/recreating it', async () => {
    const dir = await files({ '001_index.sql': indexSQL });
    const db = client(
      [
        {
          name: '001_index.sql',
          status: 'STARTED',
          checksum: hash(indexSQL),
          checkpoint: { index: 'test_idx' },
        },
      ],
      (sql) => (sql.includes('pg_get_indexdef') ? [{ indisvalid: true, definition }] : undefined),
    );
    await runMigrations(db.c, dir);
    expect(db.statements()).not.toContain(indexSQL);
    expect(db.statements().some((s) => s.startsWith('DROP INDEX'))).toBe(false);
    expect(db.statements().join('\n')).toContain('attempt=migrations.attempt+1');
  });

  it('OPS02 never drops an owned index whose definition differs', async () => {
    const dir = await files({ '001_index.sql': indexSQL });
    const db = client(
      [
        {
          name: '001_index.sql',
          status: 'FAILED',
          checksum: hash(indexSQL),
          checkpoint: { index: 'test_idx' },
        },
      ],
      (sql) =>
        sql.includes('pg_get_indexdef')
          ? [{ indisvalid: false, definition: definition.replace('operation_id', 'actor_id') }]
          : undefined,
    );
    await expect(runMigrations(db.c, dir)).rejects.toThrow('definition mismatch');
    expect(db.statements().some((s) => s.startsWith('DROP INDEX'))).toBe(false);
  });

  it('OPS02 recreates only its matching invalid index after an interrupted attempt', async () => {
    const dir = await files({ '001_index.sql': indexSQL });
    let state: object[] = [{ indisvalid: false, definition }];
    const db = client(
      [
        {
          name: '001_index.sql',
          status: 'STARTED',
          checksum: hash(indexSQL),
          checkpoint: { index: 'test_idx' },
        },
      ],
      (sql) => {
        if (sql.includes('pg_get_indexdef')) return state;
        if (sql.startsWith('DROP INDEX')) state = [];
        if (sql === indexSQL) state = [{ indisvalid: true, definition }];
      },
    );
    await runMigrations(db.c, dir);
    expect(db.statements().filter((s) => s.startsWith('DROP INDEX'))).toEqual([
      'DROP INDEX CONCURRENTLY public.test_idx',
    ]);
    expect(db.statements()).toContain(indexSQL);
  });

  it('OPS02 preserves a successfully built index if recording APPLIED fails', async () => {
    const dir = await files({ '001_index.sql': indexSQL });
    let built = false;
    const db = client([], (sql) => {
      if (sql.includes('pg_get_indexdef')) return built ? [{ indisvalid: true, definition }] : [];
      if (sql === indexSQL) built = true;
      if (sql.includes("status='APPLIED'")) throw new Error('ledger write failed');
    });
    await expect(runMigrations(db.c, dir)).rejects.toThrow('ledger write failed');
    expect(db.statements().some((s) => s.startsWith('DROP INDEX'))).toBe(false);
  });

  it('supports a nontransactional backfill without wrapping or undoing its committed batches', async () => {
    const sql = '-- acornary:no-transaction\nDO $$ BEGIN COMMIT; END $$;';
    const dir = await files({ '001_backfill.sql': sql });
    const db = client([], (statement) => {
      if (statement === sql) throw new Error('backfill interrupted');
    });
    await expect(runMigrations(db.c, dir)).rejects.toThrow('backfill interrupted');
    expect(db.statements()).not.toContain('BEGIN');
    expect(db.statements()).not.toContain('ROLLBACK');
    expect(db.statements().some((s) => s.includes("status='FAILED'"))).toBe(true);
  });

  it('uses a separate migration pool with disabled business deadlines', async () => {
    const migrations = createMigrationPool();
    try {
      expect(migrations).not.toBe(pool);
      expect(migrations.options).toMatchObject({
        max: 1,
        statement_timeout: 0,
        idle_in_transaction_session_timeout: 0,
      });
      expect(pool.options).toMatchObject({
        statement_timeout: 15000,
        idle_in_transaction_session_timeout: 15000,
      });
    } finally {
      await migrations.end();
    }
  });
});
