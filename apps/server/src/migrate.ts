import { createHash } from 'node:crypto';
import { readFile, readdir } from 'node:fs/promises';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createMigrationPool, type Client } from './db.js';

const lock = "hashtextextended('acornary-migrations',0)";
const normalize = (sql: string) => sql.replace(/\s+/g, '').toLowerCase();

// Deliberately narrow: one concurrent, plain-column btree index per file. Never
// infer ownership of arbitrary indexes from their names or sweep pg_index.
function concurrentIndex(sql: string) {
  const body = sql.replace(/^\s*--[^\n]*(?:\n|$)/gm, '').trim();
  if (!/\bCREATE\s+(?:UNIQUE\s+)?INDEX\s+CONCURRENTLY\b/i.test(body)) return;
  const match = body.match(
    /^CREATE\s+(UNIQUE\s+)?INDEX\s+CONCURRENTLY\s+([a-z_][a-z_0-9]*)\s+ON\s+(?:public\.)?([a-z_][a-z_0-9]*)\s*\(\s*([a-z_][a-z_0-9]*(?:\s*,\s*[a-z_][a-z_0-9]*)*)\s*\)\s*;?$/i,
  );
  if (!match)
    throw new Error('Concurrent index migrations require one plain-column index statement');
  const [, unique, name, table, columns] = match;
  return {
    name: name.toLowerCase(),
    definition: normalize(
      `CREATE ${unique ? 'UNIQUE ' : ''}INDEX ${name} ON public.${table} USING btree (${columns})`,
    ),
  };
}

type IndexTask = NonNullable<ReturnType<typeof concurrentIndex>>;
async function indexState(c: Client, task: IndexTask) {
  const { rows } = await c.query(
    `SELECT i.indisvalid, pg_get_indexdef(x.oid) AS definition
     FROM pg_class x JOIN pg_namespace n ON n.oid=x.relnamespace
     LEFT JOIN pg_index i ON i.indexrelid=x.oid
     WHERE n.nspname='public' AND x.relname=$1`,
    [task.name],
  );
  const index = rows[0];
  if (index && (!index.definition || normalize(index.definition) !== task.definition))
    throw new Error(`Concurrent index definition mismatch: ${task.name}`);
  return index as { indisvalid: boolean; definition: string } | undefined;
}
async function cleanInvalidIndex(c: Client, task: IndexTask) {
  const index = await indexState(c, task);
  if (index && !index.indisvalid) await c.query(`DROP INDEX CONCURRENTLY public.${task.name}`);
}

// Exported for isolated runner tests; the CLI still reads ./migrations and --grants.
export async function runMigrations(
  c: Client,
  directory = 'migrations',
  grants = false,
  trustedLegacy?: Record<string, string>,
) {
  // pg omits numeric zero startup parameters; also override any role/URL defaults.
  await c.query('SET statement_timeout = 0');
  await c.query('SET idle_in_transaction_session_timeout = 0');
  await c.query(`SELECT pg_advisory_lock(${lock})`);
  try {
    await c.query(`CREATE TABLE IF NOT EXISTS migrations(
      name text PRIMARY KEY, applied_at timestamptz DEFAULT now())`);
    await c.query(`ALTER TABLE migrations
      ADD COLUMN IF NOT EXISTS checksum text,
      ADD COLUMN IF NOT EXISTS transactional boolean,
      ADD COLUMN IF NOT EXISTS status text NOT NULL DEFAULT 'UNVERIFIED',
      ADD COLUMN IF NOT EXISTS attempt integer NOT NULL DEFAULT 0,
      ADD COLUMN IF NOT EXISTS started_at timestamptz,
      ADD COLUMN IF NOT EXISTS finished_at timestamptz,
      ADD COLUMN IF NOT EXISTS error text,
      ADD COLUMN IF NOT EXISTS checkpoint jsonb`);
    const files = await Promise.all(
      (await readdir(directory))
        .filter((n) => n.endsWith('.sql'))
        .sort()
        .map(async (name) => {
          const bytes = await readFile(resolve(directory, name));
          const sql = bytes.toString('utf8');
          return {
            name,
            sql,
            checksum: createHash('sha256').update(bytes).digest('hex'),
            transactional: !/^-- acornary:no-transaction\s*$/m.test(sql),
          };
        }),
    );
    const history = new Map(
      (await c.query('SELECT * FROM migrations')).rows.map((r) => [r.name, r]),
    );
    // Check all known hashes before applying anything, including failed attempts.
    for (const file of files) {
      const old = history.get(file.name);
      if (old?.checksum && old.checksum !== file.checksum)
        throw new Error(`Migration checksum drift: ${file.name}`);
    }
    // Only an explicitly supplied, previously recorded release manifest can
    // attest legacy receipts. Never derive evidence from today's files alone.
    const legacy = files.filter((file) => history.get(file.name)?.status === 'UNVERIFIED');
    if (trustedLegacy) {
      for (const file of legacy) {
        if (trustedLegacy[file.name] !== file.checksum)
          throw new Error(`Untrusted legacy migration: ${file.name}`);
      }
      for (const [name, row] of history) {
        if (row.status === 'UNVERIFIED' && !files.some((file) => file.name === name))
          throw new Error(`Missing legacy migration: ${name}`);
      }
    }
    for (const file of files) {
      const old = history.get(file.name);
      if (old?.status === 'APPLIED' || old?.status === 'UNVERIFIED') continue;
      const task = concurrentIndex(file.sql);
      if (task && file.transactional)
        throw new Error(`Concurrent index requires -- acornary:no-transaction: ${file.name}`);
      // A prior durable creation intent plus the same checksum/definition is
      // required before touching an index left by an interrupted attempt.
      const owned = task && old?.checkpoint?.index === task.name;
      if (task && !owned && (await indexState(c, task)))
        throw new Error(`Concurrent index already exists outside this migration: ${task.name}`);
      await c.query(
        `INSERT INTO migrations(name,applied_at,checksum,transactional,status,attempt,started_at,checkpoint)
         VALUES($1,NULL,$2,$3,'STARTED',1,clock_timestamp(),$4)
         ON CONFLICT(name) DO UPDATE SET status='STARTED',attempt=migrations.attempt+1,
         started_at=clock_timestamp(),finished_at=NULL,error=NULL`,
        [file.name, file.checksum, file.transactional, task ? { index: task.name } : null],
      );
      try {
        if (file.transactional) await c.query('BEGIN');
        let alreadyValid = false;
        if (task && owned) {
          alreadyValid = (await indexState(c, task))?.indisvalid === true;
          if (!alreadyValid) await cleanInvalidIndex(c, task);
        }
        if (!alreadyValid) await c.query(file.sql);
        if (task && !(await indexState(c, task))?.indisvalid)
          throw new Error(`Concurrent index is not valid: ${task.name}`);
        await c.query(
          `UPDATE migrations SET status='APPLIED',applied_at=clock_timestamp(),
           finished_at=clock_timestamp(),error=NULL WHERE name=$1`,
          [file.name],
        );
        if (file.transactional) await c.query('COMMIT');
      } catch (error) {
        if (file.transactional) await c.query('ROLLBACK');
        let cleanupError: unknown;
        if (task) {
          try {
            await cleanInvalidIndex(c, task);
          } catch (e) {
            cleanupError = e;
          }
        }
        const e = error as Error & { code?: string };
        await c.query(
          `UPDATE migrations SET status='FAILED',finished_at=clock_timestamp(),error=$2 WHERE name=$1`,
          [
            file.name,
            JSON.stringify({
              code: e.code,
              message: e.message,
              ...(cleanupError ? { cleanup: String(cleanupError) } : {}),
            }),
          ],
        );
        throw error;
      }
    }
    if (trustedLegacy && legacy.length) {
      await c.query('BEGIN');
      try {
        for (const file of legacy) {
          await c.query(
            `UPDATE migrations SET checksum=$2,transactional=$3,status='APPLIED',
             finished_at=clock_timestamp(),checkpoint=$4
             WHERE name=$1 AND status='UNVERIFIED'`,
            [
              file.name,
              file.checksum,
              file.transactional,
              { legacy_verified_from: 'previous_release_manifest' },
            ],
          );
        }
        await c.query('COMMIT');
      } catch (error) {
        await c.query('ROLLBACK');
        throw error;
      }
    }
    if (grants) {
      await c.query('BEGIN');
      try {
        await c.query(await readFile('deploy/grants.sql', 'utf8'));
        await c.query('COMMIT');
      } catch (error) {
        await c.query('ROLLBACK');
        throw error;
      }
    }
  } finally {
    await c.query(`SELECT pg_advisory_unlock(${lock})`);
  }
}

export async function migrate(grants = false, trustedLegacy?: Record<string, string>) {
  const pool = createMigrationPool();
  try {
    const c = await pool.connect();
    try {
      await runMigrations(c, 'migrations', grants, trustedLegacy);
    } finally {
      c.release(true);
    }
  } finally {
    await pool.end();
  }
}
if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const manifestIndex = process.argv.indexOf('--legacy-manifest');
  let trustedLegacy: Record<string, string> | undefined;
  if (manifestIndex !== -1) {
    const path = process.argv[manifestIndex + 1];
    if (!path || path.startsWith('--')) throw new Error('Missing trusted legacy manifest path');
    const value = JSON.parse(await readFile(path, 'utf8'));
    if (
      !value ||
      typeof value !== 'object' ||
      Array.isArray(value) ||
      Object.entries(value).some(
        ([name, digest]) =>
          !/^[0-9]{3,}[a-z]?_[a-z0-9_]+\.sql$/.test(name) ||
          typeof digest !== 'string' ||
          !/^[a-f0-9]{64}$/.test(digest),
      )
    )
      throw new Error('Invalid trusted legacy manifest');
    trustedLegacy = value;
  }
  await migrate(process.argv.includes('--grants'), trustedLegacy);
  console.log('Migrations applied.');
}
