// Synthetic fixtures only. Refuses a populated public schema and any non-loopback/non-audit DB.
import { readFile, readdir } from 'node:fs/promises';
import pg from 'pg';
import { generateFixture } from './fixture.js';
import { validateAuditUrl } from './audit-model.js';
const raw = process.env.BATCH0_TEST_DATABASE_URL ?? '';
validateAuditUrl(raw);
const mode = process.argv[2] ?? 'small';
if (!['small', 'performance'].includes(mode))
  throw new Error('Choose small or performance synthetic seed.');
const c = new pg.Client({
  connectionString: raw,
  connectionTimeoutMillis: 5000,
  statement_timeout: 180000,
});
try {
  await c.connect();
  if ((await c.query("SELECT 1 FROM pg_tables WHERE schemaname='public' LIMIT 1")).rowCount)
    throw new Error('Refusing to seed a populated database.');
  await c.query('BEGIN');
  await c.query(
    'CREATE TABLE migrations(name text PRIMARY KEY,applied_at timestamptz DEFAULT now())',
  );
  for (const name of (await readdir('migrations')).filter((n) => /^\d+.*\.sql$/.test(n)).sort()) {
    await c.query(await readFile(`migrations/${name}`, 'utf8'));
    await c.query('INSERT INTO migrations(name) VALUES($1)', [name]);
  }
  const s = generateFixture(mode === 'performance' ? 10000 : 40);
  const bulk = async (table: string, columns: string, types: string, rows: unknown[]) => {
    for (let offset = 0; offset < rows.length; offset += 1000)
      await c.query(
        `INSERT INTO ${table} (${columns}) SELECT ${columns} FROM jsonb_to_recordset($1::jsonb) AS r(${types})`,
        [JSON.stringify(rows.slice(offset, offset + 1000))],
      );
  };
  await bulk(
    'households',
    'id,name,timezone',
    'id text,name text,timezone text',
    s.households.map((r) => ({ ...r, name: '合成家庭' })),
  );
  await bulk(
    'actors',
    'id,household_id,name',
    'id text,household_id text,name text',
    s.actors.map((r) => ({ ...r, name: '合成操作者' })),
  );
  await bulk(
    'attribute_templates',
    'household_id,id,version,target_kind,definition',
    'household_id text,id text,version integer,target_kind text,definition jsonb',
    s.attribute_templates,
  );
  await bulk(
    'catalog_nodes',
    'id,household_id,parent_id,kind,name,revision,attributes',
    'id text,household_id text,parent_id text,kind text,name text,revision integer,attributes jsonb',
    s.catalog_nodes,
  );
  await bulk(
    'items',
    'id,household_id,catalog_node_id,parent_id,display_name,revision,attributes,created_at',
    'id text,household_id text,catalog_node_id text,parent_id text,display_name text,revision integer,attributes jsonb,created_at timestamptz',
    s.items,
  );
  await bulk(
    'notes',
    'id,household_id,item_id,created_by,title,body',
    'id text,household_id text,item_id text,created_by text,title text,body text',
    s.notes,
  );
  await bulk(
    'events',
    'id,household_id,target_kind,target_id,operation_id,actor_id,before_revision,after_revision,recorded_at,occurred_at,event_type,source,changes',
    'id text,household_id text,target_kind text,target_id text,operation_id text,actor_id text,before_revision integer,after_revision integer,recorded_at timestamptz,occurred_at timestamptz,event_type text,source text,changes jsonb',
    s.events,
  );
  await bulk(
    'operations',
    'household_id,actor_id,idempotency_key,fingerprint,fingerprint_format,result',
    'household_id text,actor_id text,idempotency_key text,fingerprint text,fingerprint_format text,result jsonb',
    s.operations,
  );
  await c.query('COMMIT');
  console.log(
    JSON.stringify({
      source_kind: 'synthetic_fixture',
      mode,
      items: s.items.length,
      events: s.events.length,
      notes: s.notes.length,
    }),
  );
} finally {
  await c.end();
}
