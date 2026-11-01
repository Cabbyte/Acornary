import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { randomUUID } from 'node:crypto';
import { mkdtemp, readFile, rm, readdir, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { pool, transaction } from '../../apps/server/src/db.js';
import { createHousehold } from '../../apps/server/src/initialize.js';
import { execute, mapDatabaseError, type Context } from '../../apps/server/src/service.js';
import { buildApp } from '../../apps/server/src/app.js';
import { debugRead, debugTables } from '../../apps/server/src/debug.js';
import {
  domainErrorStatus,
  errorRecovery,
  eventTypes,
  eventSources,
  implementedFeatures,
} from '../../packages/contracts/src/index.js';
import {
  verifyReleaseMigrations,
  verifyTemplateSchemas,
  verifyAttachmentStorage,
  verifyStartup,
  release,
} from '../../apps/server/src/release.js';
import {
  snapshot,
  compareRestore,
  backupRequiredTables,
  assertBackupCoverage,
  resetRestoredSync,
} from '../../apps/server/src/verify-restore.js';
import { syncState, syncChanges } from '../../apps/server/src/sync-api.js';

const id = (kind: string) => `${kind}_${randomUUID()}`;
let ctx: Context, other: Context, item: string, sku: string, foreign: string, root: string;
async function fixture() {
  const household = await transaction((c) => createHousehold(c, 'batch8'));
  const ctx = { ...household, source: 'TEST' };
  const result = await execute(ctx, 'create_items', {
    catalog_node_id: household.container_catalog_id,
    count: 1,
    idempotency_key: randomUUID(),
  });
  return {
    ctx,
    item: result.affected_objects[0].id as string,
    sku: household.container_catalog_id,
  };
}
// Roll back successful mutations too, preserving append-only fixtures across tests.
async function rolledBack(fn: (c: any) => Promise<void>) {
  const c = await pool.connect();
  try {
    await c.query('BEGIN');
    await fn(c);
  } finally {
    await c.query('ROLLBACK');
    c.release();
  }
}
async function event(c: any, kind: string, target: string, source = 'TEST', type = 'UPDATE') {
  const operation = id('operation');
  await c.query(
    'INSERT INTO operations(household_id,actor_id,idempotency_key,fingerprint,result) VALUES($1,$2,$3,$4,$5)',
    [ctx.household_id, ctx.actor_id, randomUUID(), 'fixture', { operation_id: operation }],
  );
  return c.query(
    `INSERT INTO events(id,household_id,target_kind,target_id,operation_id,event_type,before_revision,after_revision,changes,actor_id,source,occurred_at)
    VALUES($1,$2,$3,$4,$5,$6,1,2,'[]',$7,$8,now()) RETURNING id`,
    [id('event'), ctx.household_id, kind, target, operation, type, ctx.actor_id, source],
  );
}
async function rejected(fn: (c: any) => Promise<any>, constraint: string, code = '23503') {
  await rolledBack(async (c) => {
    await expect(fn(c)).rejects.toMatchObject({ code, constraint });
  });
}

describe('Batch 8 PostgreSQL hardening', () => {
  beforeAll(async () => {
    if (new URL(process.env.DATABASE_URL!).pathname !== '/acornary_test_w4_hardening')
      throw new Error('Requires isolated Batch 8 database.');
    root = await mkdtemp(join(tmpdir(), 'acornary-batch8-'));
    process.env.ACORNARY_ATTACHMENT_ROOT = root;
    process.env.LOG_LEVEL = 'silent';
    ({ ctx, item, sku } = await fixture());
    const second = await fixture();
    other = second.ctx;
    foreign = second.item;
  });
  afterAll(async () => {
    delete process.env.ACORNARY_REQUIRE_PROTOCOL_V2;
    await pool.end();
    await rm(root, { recursive: true, force: true });
  });

  it('OP08 accepts both target kinds, rejects missing/wrong/foreign targets, keeps audit immutable', async () => {
    await rolledBack(async (c) => {
      await event(c, 'ITEM', item);
      await event(c, 'CATALOG_NODE', sku);
      await c.query('SET CONSTRAINTS ALL IMMEDIATE');
    });
    for (const [kind, target] of [
      ['ITEM', id('item')],
      ['ITEM', sku],
      ['CATALOG_NODE', item],
      ['ITEM', foreign],
      ['NOTE', item],
    ])
      await rejected((c) => event(c, kind, target), 'events_target_guard');
    await rejected(
      (c) =>
        c.query('UPDATE events SET reason=$1 WHERE household_id=$2', ['changed', ctx.household_id]),
      'immutable_events',
      '23514',
    );
    await rejected(
      (c) => c.query('DELETE FROM events WHERE household_id=$1', [ctx.household_id]),
      'immutable_events',
      '23514',
    );
  });

  it('rollout validates historical rows without rewriting events, and aborts on bad targets', async () => {
    const migration = await readFile('migrations/018_hardening.sql', 'utf8');
    const undo = `
      ALTER TABLE events DROP CONSTRAINT events_source_check, DROP CONSTRAINT events_event_type_check;
      DROP TRIGGER events_target_guard ON events;
      DROP TRIGGER attribute_references_guard ON attribute_references;
      DROP TRIGGER item_splits_guard ON item_splits;
      DROP TRIGGER immutable_item_splits ON item_splits;
      DROP FUNCTION guard_event_target(), guard_attribute_reference(), guard_item_split();
      DROP FUNCTION reject_hardening_mutation() CASCADE;
      DROP FUNCTION hardening_target_exists(text,text,text);
      CREATE TRIGGER immutable_events BEFORE UPDATE OR DELETE ON events FOR EACH ROW EXECUTE FUNCTION reject_mutation();
    `;
    await rolledBack(async (c) => {
      const before = (await c.query('SELECT to_jsonb(e) AS row FROM events e ORDER BY id')).rows;
      await c.query(undo);
      await c.query(migration);
      expect((await c.query('SELECT to_jsonb(e) AS row FROM events e ORDER BY id')).rows).toEqual(
        before,
      );
      expect(
        (
          await c.query(
            "SELECT bool_and(convalidated) AS valid FROM pg_constraint WHERE conname IN ('events_source_check','events_event_type_check')",
          )
        ).rows[0].valid,
      ).toBe(true);
    });
    await rolledBack(async (c) => {
      await c.query(undo);
      await event(c, 'ITEM', foreign);
      await c.query('SET CONSTRAINTS ALL IMMEDIATE');
      await expect(c.query(migration)).rejects.toThrow(/preflight failed: events targets/);
    });
  });

  it('OPS08 runtime grants permit guarded inserts but deny history mutation and administrative reset', async () => {
    await rolledBack(async (c) => {
      const exists = (await c.query("SELECT 1 FROM pg_roles WHERE rolname='acornary_app'"))
        .rowCount;
      if (!exists) await c.query('CREATE ROLE acornary_app NOLOGIN');
      // Exercise the deployment grants without changing them or persisting role changes.
      await c.query(await readFile('deploy/grants.sql', 'utf8'));
      await c.query('SET LOCAL ROLE acornary_app');
      await event(c, 'ITEM', item);
      await c.query(
        `INSERT INTO attribute_references VALUES($1,'ITEM',$2,'custody','owner','ACTOR',$3)`,
        [ctx.household_id, item, ctx.actor_id],
      );
      await c.query('SET CONSTRAINTS ALL IMMEDIATE');
      for (const sql of [
        'UPDATE actors SET name=name',
        'UPDATE events SET reason=NULL',
        'DELETE FROM events',
        'UPDATE item_splits SET quantity=2',
        'DELETE FROM item_splits',
        "SELECT reset_household_sync('unavailable')",
      ]) {
        await c.query('SAVEPOINT denied');
        await expect(c.query(sql)).rejects.toMatchObject({ code: '42501' });
        await c.query('ROLLBACK TO SAVEPOINT denied');
      }
      await expect(event(c, 'ITEM', foreign)).rejects.toMatchObject({
        constraint: 'events_target_guard',
      });
    });
  });

  it('OPS08 checks every registered event/source and rejects unknown vocabulary', async () => {
    await rolledBack(async (c) => {
      for (const type of eventTypes) await event(c, 'ITEM', item, 'TEST', type);
      for (const source of eventSources) await event(c, 'ITEM', item, source);
      await c.query('SET CONSTRAINTS ALL IMMEDIATE');
    });
    await rejected((c) => event(c, 'ITEM', item, 'UNREGISTERED'), 'events_source_check', '23514');
    await rejected(
      (c) => event(c, 'ITEM', item, 'TEST', 'NOT_AN_EVENT'),
      'events_event_type_check',
      '23514',
    );
    // Existing producer naming, including deadline names, is preserved verbatim.
    const migration = await readFile('migrations/018_hardening.sql', 'utf8');
    for (const value of [...eventTypes, ...eventSources]) expect(migration).toContain(`'${value}'`);
  });

  it('covers note/attachment/upload targets and reverse-reference sources and destinations', async () => {
    const note = id('note'),
      blob = id('blob');
    await pool.query(
      `INSERT INTO notes(id,household_id,item_id,body,created_by) VALUES($1,$2,$3,'private body',$4)`,
      [note, ctx.household_id, item, ctx.actor_id],
    );
    await pool.query(
      `INSERT INTO attachment_blobs(id,household_id,storage_key,mime_type,file_size,sha256) VALUES($1,$2,$3,'application/pdf',10,$4)`,
      [blob, ctx.household_id, randomUUID(), 'a'.repeat(64)],
    );
    const file = (c: any, kind: string, target: string) =>
      c.query(
        `INSERT INTO attachments(id,household_id,blob_id,target_kind,target_id,caption,created_by) VALUES($1,$2,$3,$4,$5,'private caption',$6)`,
        [id('attachment'), ctx.household_id, blob, kind, target, ctx.actor_id],
      );
    await rolledBack(async (c) => {
      for (const [kind, target] of [
        ['ITEM', item],
        ['CATALOG_NODE', sku],
        ['NOTE', note],
      ])
        await file(c, kind, target);
    });
    for (const target of [foreign, id('item')]) {
      await rejected((c) => file(c, 'ITEM', target), 'attachments_target_guard');
      await rejected(
        (c) =>
          c.query(
            `INSERT INTO notes(id,household_id,target_kind,target_id,body,created_by) VALUES($1,$2,'CATALOG_NODE',$3,'x',$4)`,
            [id('note'), ctx.household_id, target, ctx.actor_id],
          ),
        'notes_target_guard',
      );
      await rejected(
        (c) =>
          c.query(
            `INSERT INTO upload_sessions(id,household_id,actor_id,target_kind,target_id,file_size,ticket_hash,expires_at,storage_key) VALUES($1,$2,$3,'ITEM',$4,1,'secret',now(),$5)`,
            [id('upload'), ctx.household_id, ctx.actor_id, target, randomUUID()],
          ),
        'uploads_target_guard',
      );
    }
    const reference = (c: any, source: string, kind: string, target: string) =>
      c.query(`INSERT INTO attribute_references VALUES($1,'ITEM',$2,'custody','owner',$3,$4)`, [
        ctx.household_id,
        source,
        kind,
        target,
      ]);
    for (const [kind, target] of [
      ['ACTOR', ctx.actor_id],
      ['ITEM', item],
      ['CATALOG_NODE', sku],
    ])
      await rolledBack((c) => reference(c, item, kind, target));
    for (const [source, kind, target] of [
      [foreign, 'ITEM', item],
      [item, 'ACTOR', other.actor_id],
      [item, 'ITEM', foreign],
      [item, 'CATALOG_NODE', id('catalog_node')],
    ])
      await rejected((c) => reference(c, source, kind, target), 'attribute_references_guard');
  });

  it('split FKs and provenance guards reject foreign children, duplicate children, and re-splits', async () => {
    const child = (await fixture()).item; // Foreign household is rejected by existing FK.
    const op = (
      await pool.query('SELECT operation_id FROM operations WHERE household_id=$1 LIMIT 1', [
        ctx.household_id,
      ])
    ).rows[0].operation_id;
    const split = async (c: any, source: string, child: string, splitId = 'split_fixture') =>
      c.query(
        `INSERT INTO item_splits(household_id,split_id,source_item_id,child_item_id,operation_id,quantity,unit,basis) VALUES($1,$2,$3,$4,$5,1,'count','COUNT')`,
        [ctx.household_id, splitId, source, child, op],
      );
    await rejected((c) => split(c, item, child), 'item_splits_household_id_child_item_id_fkey');
    const children = await execute(ctx, 'create_items', {
      catalog_node_id: sku,
      count: 2,
      idempotency_key: randomUUID(),
    });
    const [a, b] = children.affected_objects.map((o: any) => o.id);
    await rolledBack(async (c) => {
      await split(c, item, a);
      await split(c, item, b);
      await c.query('SET CONSTRAINTS ALL IMMEDIATE');
    });
    await rolledBack(async (c) => {
      await split(c, item, a);
      await expect(split(c, item, b, 'different')).rejects.toMatchObject({
        constraint: 'item_splits_guard',
      });
    });
    await rolledBack(async (c) => {
      await split(c, item, a);
      await expect(split(c, b, a, 'different')).rejects.toMatchObject({ code: '23505' });
    });
    await rolledBack(async (c) => {
      await split(c, item, a);
      await expect(
        c.query('DELETE FROM item_splits WHERE household_id=$1', [ctx.household_id]),
      ).rejects.toMatchObject({ constraint: 'immutable_item_splits' });
    });
  });

  it('maps actual PostgreSQL constraints without leaking detail or collapsing unique conflicts', async () => {
    await rolledBack(async (c) => {
      await c.query('INSERT INTO barcode_index VALUES($1,$2,$3)', [
        ctx.household_id,
        'batch8',
        sku,
      ]);
      try {
        await c.query('INSERT INTO barcode_index VALUES($1,$2,$3)', [
          ctx.household_id,
          'batch8',
          sku,
        ]);
        throw new Error('Expected conflict');
      } catch (error) {
        expect(mapDatabaseError({ cause: error })).toMatchObject({ code: 'BARCODE_CONFLICT' });
        expect(JSON.stringify(mapDatabaseError(error))).not.toContain('batch8');
      }
    });
    for (const [sql, constraint, domain] of [
      ['23505', 'operations_pkey', 'IDEMPOTENCY_CONFLICT'],
      ['23505', 'items_pkey', 'STATE_CONFLICT'],
      ['23503', 'events_target_guard', 'REFERENCE_INVALID'],
      ['23514', 'item_splits_guard', 'STATE_CONFLICT'],
      ['23514', 'attachment_blobs_file_size_check', 'ATTACHMENT_TOO_LARGE'],
      ['23514', 'attachment_blobs_mime_type_check', 'ATTACHMENT_TYPE_UNSUPPORTED'],
    ])
      expect(mapDatabaseError({ code: sql, constraint, detail: 'secret' })).toMatchObject({
        code: domain,
      });
    const unexpected = { code: '08006' };
    expect(mapDatabaseError(unexpected)).toBe(unexpected);
    for (const [code, status, recovery] of [
      ['BARCODE_CONFLICT', 400, 'FIX_REQUEST'],
      ['REFERENCE_INVALID', 400, 'FIX_REQUEST'],
      ['STATE_CONFLICT', 409, 'REREAD_AND_REVIEW'],
      ['SYNC_RESET_REQUIRED', 409, 'REREAD_AND_REVIEW'],
      ['PROTOCOL_VERSION_UNSUPPORTED', 409, 'FIX_REQUEST'],
      ['INVALID_CURSOR', 400, 'FIX_REQUEST'],
      ['UNSUPPORTED_WRITE_ISOLATION', 400, 'FIX_REQUEST'],
      ['ATTACHMENT_TOO_LARGE', 413, 'FIX_REQUEST'],
      ['ATTACHMENT_QUOTA_EXCEEDED', 409, 'FIX_REQUEST'],
      ['ATTACHMENT_TYPE_UNSUPPORTED', 400, 'FIX_REQUEST'],
    ] as const) {
      expect(domainErrorStatus(code)).toBe(status);
      expect(errorRecovery(code)).toBe(recovery);
    }
  });

  it('OPS05 defaults to compatibility; switch rejects business requests before writes and permits negotiation', async () => {
    delete process.env.ACORNARY_REQUIRE_PROTOCOL_V2;
    const compat = await buildApp(ctx, 'token', false);
    expect((await compat.inject({ method: 'GET', url: '/api/read/query_items' })).statusCode).toBe(
      200,
    );
    await compat.close();
    process.env.ACORNARY_REQUIRE_PROTOCOL_V2 = '1';
    const app = await buildApp(ctx, 'token', false);
    try {
      const before = (
        await pool.query('SELECT count(*) FROM operations WHERE household_id=$1', [
          ctx.household_id,
        ])
      ).rows[0].count;
      for (const url of [
        '/api/read/query_items',
        '/api/ui/snapshot',
        '/api/debug',
        '/api/sync/state',
        '/api/attachments/missing',
        '/api/terminal/v1/snapshot',
      ])
        for (const version of [undefined, '1', '3']) {
          const response = await app.inject({
            method: 'GET',
            url,
            headers: version ? { 'x-acornary-protocol': version } : {},
          });
          expect(response.statusCode).toBe(409);
          expect(response.json().error).toMatchObject({
            code: 'PROTOCOL_VERSION_UNSUPPORTED',
            recovery: 'FIX_REQUEST',
          });
        }
      const rejected = await app.inject({
        method: 'POST',
        url: '/api/write/create_items',
        payload: { catalog_node_id: sku, count: 1, idempotency_key: randomUUID() },
      });
      expect(rejected.statusCode).toBe(409);
      const mcp = await app.inject({
        method: 'POST',
        url: '/mcp',
        payload: {
          jsonrpc: '2.0',
          id: 1,
          method: 'tools/call',
          params: { name: 'query_items', arguments: {} },
        },
      });
      expect(mcp.statusCode).toBe(409);
      for (const url of [
        '/health',
        '/api/version',
        '/api/session',
        '/api/context',
        '/api/read/get_connection_context',
      ])
        expect((await app.inject({ method: 'GET', url })).statusCode).toBe(200);
      for (const url of ['/api/context', '/api/read/get_connection_context']) {
        const response = (await app.inject({ method: 'GET', url })).json();
        expect(response.features).toEqual([...implementedFeatures]);
        expect(response.features).not.toContain('redaction_v2');
        expect(response.features).not.toContain('protocol_v2');
      }
      expect(
        (
          await app.inject({
            method: 'GET',
            url: '/api/read/query_items',
            headers: { 'x-acornary-protocol': '2' },
          })
        ).statusCode,
      ).toBe(200);
      expect(
        (
          await pool.query('SELECT count(*) FROM operations WHERE household_id=$1', [
            ctx.household_id,
          ])
        ).rows[0].count,
      ).toBe(before);
    } finally {
      await app.close();
      delete process.env.ACORNARY_REQUIRE_PROTOCOL_V2;
    }
  });

  it('OPS09 inspector scopes and paginates governance metadata without raw payloads or secrets', async () => {
    await pool.query(
      `INSERT INTO catalog_policy_versions VALUES($1,1,'[]',$2,'private reason',now())`,
      [ctx.household_id, ctx.actor_id],
    );
    await pool.query(
      `INSERT INTO catalog_proposals(id,household_id,actor_id,proposal,challenge_hash) VALUES($1,$2,$3,$4,'private challenge')`,
      [randomUUID(), ctx.household_id, ctx.actor_id, { secret: 'private proposal' }],
    );
    await pool.query(`INSERT INTO catalog_identity_keys VALUES($1,'private identity',$2,1)`, [
      ctx.household_id,
      sku,
    ]);
    for (const table of debugTables) {
      const result = await debugRead(ctx, { view: 'system', table, limit: 1 });
      for (const row of result.rows)
        if (row.household_id) expect(row.household_id).toBe(ctx.household_id);
      expect(JSON.stringify(result.rows)).not.toMatch(
        /private (body|caption|reason|challenge|proposal|identity)/,
      );
      if (result.next_cursor) {
        const next = await debugRead(ctx, {
          view: 'system',
          table,
          limit: 1,
          cursor: result.next_cursor,
        });
        expect(next.rows).not.toEqual(result.rows);
        await expect(
          debugRead(other, { view: 'system', table, cursor: result.next_cursor }),
        ).rejects.toMatchObject({ code: 'INVALID_CURSOR' });
      }
    }
    const notes = await debugRead(ctx, {
      view: 'object',
      table: 'notes',
      target: { kind: 'ITEM', id: item },
    });
    expect(notes.rows[0]).not.toHaveProperty('body');
    expect(notes.rows[0].redacted_paths).toContain('body');
    await expect(
      debugRead(ctx, { view: 'object', table: 'items', target: { kind: 'ITEM', id: foreign } }),
    ).rejects.toMatchObject({ code: 'NOT_FOUND' });
    await expect(
      debugRead(ctx, { view: 'system', table: 'items', cursor: 'garbage' }),
    ).rejects.toMatchObject({ code: 'INVALID_CURSOR' });
    expect(
      (await debugRead(ctx, { view: 'system', table: 'catalog_proposals' })).rows[0],
    ).not.toHaveProperty('challenge_hash');
  });

  it('OPS09 verifies all shipped migration hashes, template schemas, storage readback and sanitized health', async () => {
    const status = await verifyStartup();
    expect(status.migrations.count).toBe(Object.keys(release.migrations).length);
    expect(status.templates.hash).toMatch(/^[a-f0-9]{64}$/);
    await expect(
      verifyReleaseMigrations(pool, { '999_missing.sql': 'a'.repeat(64) }),
    ).rejects.toThrow(/missing/);
    await expect(
      verifyReleaseMigrations(pool, { '018_hardening.sql': 'a'.repeat(64) }),
    ).rejects.toThrow(/changed/);
    await rolledBack(async (c) => {
      await c.query("UPDATE migrations SET status='UNVERIFIED' WHERE name='018_hardening.sql'");
      await expect(verifyReleaseMigrations(c)).rejects.toThrow(/unverified/);
    });
    await rolledBack(async (c) => {
      await c.query('ALTER TABLE attribute_templates DISABLE TRIGGER immutable_templates');
      await c.query(
        `UPDATE attribute_templates SET definition=jsonb_set(definition,'{schema}', '{"type":"null"}') WHERE household_id=$1 AND id='lifecycle'`,
        [ctx.household_id],
      );
      await expect(verifyTemplateSchemas(c)).rejects.toThrow(/hash mismatch/);
    });
    const invalidRoot = join(root, 'file');
    await writeFile(invalidRoot, 'x');
    await expect(verifyAttachmentStorage(invalidRoot)).rejects.toThrow();
    const app = await buildApp(ctx, 'token', false);
    try {
      const response = await app.inject({ method: 'GET', url: '/health' });
      expect(response.statusCode).toBe(200);
      expect(response.json().backup.status).toBe('unverified');
      expect(response.body).not.toContain(root);
      expect(response.body).not.toContain(ctx.household_id);
      process.env.ACORNARY_ATTACHMENT_ROOT = invalidRoot;
      const failed = await app.inject({ method: 'GET', url: '/health' });
      expect(failed.statusCode).toBe(503);
      expect(failed.json().storage).toEqual({ status: 'failed' });
      expect(failed.body).not.toContain(invalidRoot);
    } finally {
      process.env.ACORNARY_ATTACHMENT_ROOT = root;
      await app.close();
    }
    expect((await readdir(root)).filter((name) => name.startsWith('.readiness'))).toEqual([]);
  });

  it('OPS06 manifest covers all new tables, detects metadata drift and uses a backup-time snapshot', async () => {
    const c = await pool.connect();
    try {
      await c.query('BEGIN ISOLATION LEVEL REPEATABLE READ READ ONLY');
      const exported = (await c.query('SELECT pg_export_snapshot() AS id')).rows[0].id;
      const before = await snapshot(pool, exported);
      for (const table of backupRequiredTables) expect(before.tables[table]).toBeDefined();
      await pool.query(
        `INSERT INTO notes(id,household_id,item_id,body,created_by) VALUES($1,$2,$3,'manifest delta',$4)`,
        [id('note'), ctx.household_id, item, ctx.actor_id],
      );
      expect(compareRestore(before, await snapshot(pool, exported))).toMatchObject({
        identical: true,
        attachment_bytes: 'NOT_VERIFIED',
      });
      expect(() =>
        compareRestore(before, {
          ...before,
          tables: { ...before.tables, attachments: { count: 1, sha256: '0'.repeat(64) } },
        }),
      ).toThrow(/attachments/);
      expect(() =>
        compareRestore(before, {
          ...before,
          tables: { ...before.tables, attachment_blobs: { count: 1, sha256: '0'.repeat(64) } },
        }),
      ).toThrow(/attachment_blobs/);
      const current = await snapshot(pool);
      const missing = structuredClone(before);
      delete missing.tables.item_splits;
      expect(() => assertBackupCoverage(missing)).toThrow(/Incomplete/);
      expect(() => compareRestore(before, before)).not.toThrow();
      expect(() => compareRestore(before, current)).toThrow(/notes/);
    } finally {
      await c.query('ROLLBACK');
      c.release();
    }
  });

  it.todo(
    'OPS07 independent NAS/SFTP backup decryption and offsite restore require production credentials and independently held keys',
  );

  it('OPS06 reset after verification invalidates old sync cursors without deleting receipts', async () => {
    const before = await syncState(ctx);
    const receipts = (await pool.query('SELECT count(*) FROM operations')).rows[0].count;
    await resetRestoredSync(pool); // Isolated lane DB only; CLI restricts this to restore DBs.
    expect((await syncState(ctx)).generation).not.toBe(before.generation);
    await expect(
      syncChanges(ctx, { generation: before.generation, cursor: '0' }),
    ).rejects.toMatchObject({ code: 'SYNC_RESET_REQUIRED' });
    expect((await pool.query('SELECT count(*) FROM operations')).rows[0].count).toBe(receipts);
  });
});
