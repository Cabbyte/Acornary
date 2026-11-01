import { readFile, mkdir, writeFile } from 'node:fs/promises';
import { resolve, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import pg from 'pg';
import { auditSnapshot, validateAuditUrl, digest, type AuditSnapshot } from './audit-model.js';
import { terminalLabelTimes } from '../../tests/batch0/label-oracle.js';

export async function readAuditSnapshot(c: pg.Client): Promise<AuditSnapshot> {
  // Caller owns one READ ONLY snapshot. Explicit selection avoids auth tables and receipt/note bodies.
  const rows = async (sql: string) => (await c.query(sql)).rows;
  return {
    households: await rows('SELECT id,timezone FROM households ORDER BY id'),
    actors: await rows('SELECT id,household_id FROM actors ORDER BY id'),
    catalog_nodes: await rows(
      'SELECT id,household_id,parent_id,kind,name,revision,attributes FROM catalog_nodes ORDER BY id',
    ),
    items: await rows(
      'SELECT id,household_id,parent_id,catalog_node_id,display_name,revision,attributes,created_at FROM items ORDER BY id',
    ),
    attribute_templates: await rows(
      'SELECT household_id,id,version,target_kind,definition FROM attribute_templates ORDER BY household_id,id,version',
    ),
    barcode_index: await rows(
      'SELECT household_id,barcode,catalog_node_id FROM barcode_index ORDER BY household_id,barcode',
    ),
    notes: (await rows("SELECT to_jsonb(n)-'body'-'title' AS row FROM notes n ORDER BY id")).map(
      (r) => r.row,
    ),
    events:
      await rows(`SELECT id,household_id,target_kind,target_id,operation_id,actor_id,before_revision,after_revision,recorded_at,
      jsonb_typeof(changes) AS changes_type,
      coalesce((SELECT jsonb_agg(ch) FROM jsonb_array_elements(CASE WHEN jsonb_typeof(changes)='array' THEN changes ELSE '[]'::jsonb END) ch
      WHERE ch->>'path' IN ('display_name','catalog_node_id','name','attributes.product.specification','attributes.lifecycle.expiry.date','attributes.lifecycle.expiry.date_kind')), '[]'::jsonb) AS changes
      FROM events ORDER BY recorded_at DESC,id DESC`),
    operations: await rows(
      "SELECT household_id,actor_id,result->>'operation_id' AS result_operation_id,to_jsonb(o)->>'operation_id' AS operation_id,to_jsonb(o) ? 'operation_id' AS operation_id_column_present FROM operations o ORDER BY household_id,actor_id,idempotency_key",
    ),
    migrations: (await rows('SELECT to_jsonb(m) AS row FROM migrations m ORDER BY name')).map(
      (r) => r.row,
    ),
    catalog_policy_versions: await rows(
      'SELECT household_id,revision FROM catalog_policy_versions ORDER BY household_id,revision',
    ),
    catalog_identity_keys: await rows(
      'SELECT household_id,catalog_node_id,policy_revision FROM catalog_identity_keys ORDER BY household_id,identity_key',
    ),
  };
}

async function main() {
  const args = process.argv.slice(2);
  if (
    args.length !== 4 ||
    args[0] !== '--source' ||
    !['synthetic_fixture', 'restored_copy'].includes(args[1]) ||
    args[2] !== '--output'
  )
    throw new Error('Usage: audit.ts --source synthetic_fixture|restored_copy --output DIRECTORY');
  const raw = process.env.BATCH0_AUDIT_DATABASE_URL ?? '';
  validateAuditUrl(raw); // Reject production names, non-loopback destinations and URL overrides before connecting.
  const output = resolve(args[3]);
  await mkdir(output, { recursive: true, mode: 0o700 });
  const c = new pg.Client({
    connectionString: raw,
    options: '-c default_transaction_read_only=on',
    connectionTimeoutMillis: 5000,
    statement_timeout: 180000,
    application_name: 'acornary-batch0-readonly-audit',
  });
  try {
    await c.connect();
    await c.query('BEGIN ISOLATION LEVEL REPEATABLE READ READ ONLY');
    const context = (
      await c.query(
        "SELECT current_database() AS database, current_setting('transaction_read_only') AS read_only,current_setting('transaction_isolation') AS isolation,version() AS postgres,txid_current_snapshot()::text AS snapshot",
      )
    ).rows[0];
    const snapshot = await readAuditSnapshot(c);
    const report = auditSnapshot(snapshot);
    await c.query('COMMIT');
    const oracleSource = JSON.parse(
      await readFile(
        new URL('../../tests/batch0/label-oracle.provenance.json', import.meta.url),
        'utf8',
      ),
    );
    const baseline: Record<string, string> = {};
    if (report.errors === 0)
      for (const h of snapshot.households) {
        const data: any = {
          household: h,
          container_catalog_id: '',
          cached_at: '',
          notes: [],
          catalog: snapshot.catalog_nodes.filter((r) => r.household_id === h.id),
          items: snapshot.items.filter((r) => r.household_id === h.id),
        };
        for (const [id, time] of terminalLabelTimes(
          data,
          snapshot.events.filter((e) => e.household_id === h.id) as any,
        ))
          baseline[id] = time;
      }
    const evidence = {
      ...report,
      captured_at: new Date().toISOString(),
      source_kind: args[1],
      production_provenance: 'NOT_VERIFIED',
      context,
      audited_projection_sha256: digest(snapshot),
      label_oracle: {
        status: report.errors ? 'NOT_RUN_INVALID_SOURCE' : 'BASELINE_ONLY',
        count: Object.keys(baseline).length,
        sha256: digest(baseline),
        source_sha256: oracleSource.source_sha256,
        new_projection_comparison: 'NOT_RUN',
      },
    };
    await writeFile(join(output, 'audit.json'), JSON.stringify(evidence, null, 2) + '\n', {
      mode: 0o600,
      flag: 'wx',
    });
    await writeFile(join(output, 'label-baseline.json'), JSON.stringify(baseline, null, 2) + '\n', {
      mode: 0o600,
      flag: 'wx',
    });
    console.log(
      JSON.stringify({
        source_kind: args[1],
        verdict: report.verdict,
        errors: report.errors,
        reviews: report.reviews,
        output,
        production_audit: 'NOT_RUN',
        new_projection_comparison: 'NOT_RUN',
      }),
    );
    if (report.errors) process.exitCode = 2;
  } finally {
    await c.end();
  }
}
if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main().catch(() => {
    console.error(
      'Batch 0 audit failed. No database repair was attempted; inspect configuration privately.',
    );
    process.exitCode = 1;
  });
}
