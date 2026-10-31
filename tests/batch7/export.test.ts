import * as db from '../../apps/server/src/db.js';
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { randomUUID } from 'node:crypto';
import { execute, type Context } from '../../apps/server/src/service.js';
import { cleanupExports } from '../../apps/server/src/exports.js';
import { createHousehold } from '../../apps/server/src/initialize.js';
import { pool, query, transaction } from '../../apps/server/src/db.js';
import { buildApp } from '../../apps/server/src/app.js';
import type { BeginExport, Operation } from '../../packages/contracts/src/index.js';

let ctx: Context, sku: string, items: string[];
const selection: BeginExport = {
  kind: 'ITEM',
  query: { sort: { field: 'name', direction: 'asc' } },
};
const write = (operation: Operation, input: any) =>
  execute(ctx, operation, { idempotency_key: randomUUID(), ...input });
const begin = (input: BeginExport = selection) => execute(ctx, 'begin_export', input);
const page = (id: string, extra: any = {}, input: BeginExport = selection, context = ctx) =>
  execute(context, 'read_export', { ...input, export_id: id, ...extra });
const stale = (promise: Promise<any>) =>
  expect(promise).rejects.toMatchObject({ code: 'CURSOR_STALE' });
async function inventory() {
  return (
    await query(
      pool,
      `SELECT
    (SELECT count(*)::integer FROM events WHERE household_id=$1) AS events,
    (SELECT count(*)::integer FROM operations WHERE household_id=$1) AS operations,
    (SELECT count(*)::integer FROM sync_changes WHERE household_id=$1) AS sync,
    (SELECT last_committed_change_id::text FROM household_sync_state WHERE household_id=$1) AS watermark,
    (SELECT jsonb_agg(to_jsonb(i) ORDER BY id) FROM items i WHERE household_id=$1) AS items,
    (SELECT jsonb_agg(to_jsonb(n) ORDER BY id) FROM catalog_nodes n WHERE household_id=$1) AS catalog`,
      [ctx.household_id],
    )
  ).rows[0];
}

describe.skipIf(!process.env.DATABASE_URL)(
  'QUERY04/05 private frozen exports on PostgreSQL',
  () => {
    beforeAll(() => {
      if (new URL(process.env.DATABASE_URL!).pathname !== '/acornary_test_w5_export')
        throw Error('Requires dedicated frozen-export database.');
      process.env.LOG_LEVEL = 'silent';
    });
    beforeEach(async () => {
      ctx = { ...(await transaction((c) => createHousehold(c))), source: 'TEST' };
      sku = 'catalog_node_' + randomUUID();
      await query(
        pool,
        `INSERT INTO catalog_nodes(id,household_id,kind,name,profile)
      VALUES($1,$2,'SKU','Frozen product','DURABLE')`,
        [sku, ctx.household_id],
      );
      const result = await write('create_items', {
        catalog_node_id: sku,
        count: 4,
        display_name: 'Before',
        initial_attributes: [
          {
            template_id: 'asset',
            template_version: 1,
            values: {
              serial_no: 'PRIVATE-SERIAL',
              imei: 'PRIVATE-IMEI',
              mac: 'PRIVATE-MAC',
              vendor: 'Public vendor',
            },
          },
        ],
      });
      items = result.affected_objects.map((o: any) => o.id);
    });
    afterAll(async () => {
      await pool.end();
    });

    it('QUERY04 freezes rows, ordering and full-set summary through live update/consume/create and varying page sizes', async () => {
      const live = await execute(ctx, 'query_items', selection.query);
      const frozen = await begin();
      const first = await page(frozen.export_id, { limit: 1 });
      await write('update_item', {
        item_id: items[1],
        display_name: 'After',
        expected_revisions: { [items[1]]: 1 },
      });
      await write('consume_items', { item_ids: [items[2]], expected_revisions: { [items[2]]: 1 } });
      await write('create_items', { catalog_node_id: sku, count: 1, display_name: 'Added' });
      const second = await page(frozen.export_id, { limit: 2, cursor: first.next_cursor });
      const third = await page(frozen.export_id, { limit: 2, cursor: second.next_cursor });
      const rows = [...first.data, ...second.data, ...third.data];
      expect(rows.map((r) => r.id)).toEqual(live.data.map((r: any) => r.id));
      expect(new Set(rows.map((r) => r.id)).size).toBe(4);
      expect(rows.every((r) => r.display_name === 'Before' && r.revision === 1)).toBe(true);
      expect(third.next_cursor).toBeNull();
      for (const result of [frozen, first, second, third]) {
        expect(result.summary).toEqual(live.summary);
        expect(result.matching_count).toBe(4);
        expect(result.as_of_change_id).toBe(live.as_of_change_id);
      }
      expect((await page(frozen.export_id, { limit: 1 })).data).toEqual(first.data);
      expect(
        (await execute(ctx, 'query_items', selection.query)).data.some(
          (r: any) => r.display_name === 'After',
        ),
      ).toBe(true);
      expect((await inventory()).watermark).not.toBe(frozen.as_of_change_id);
    });

    it('QUERY04 materializes more than one internal query page and survives a fresh executor request', async () => {
      for (const count of [100, 100, 5])
        await write('create_items', { catalog_node_id: sku, count, display_name: 'Many' });
      const expected = await execute(ctx, 'query_items', { ...selection.query, limit: 200 });
      const expectedTail = await execute(ctx, 'query_items', {
        ...selection.query,
        cursor: expected.next_cursor,
      });
      const originalQuery = db.query;
      let pendingWrite = true;
      const spy = vi
        .spyOn(db, 'query')
        .mockImplementation(async (...args: Parameters<typeof db.query>) => {
          const result = await originalQuery(...args);
          if (pendingWrite && args[1].includes('INSERT INTO frozen_export_rows')) {
            pendingWrite = false;
            const id = expectedTail.data[0].id;
            await write('update_item', {
              item_id: id,
              display_name: 'Changed during capture',
              expected_revisions: { [id]: 1 },
            });
          }
          return result;
        });
      let frozen: any;
      try {
        frozen = await begin();
      } finally {
        spy.mockRestore();
      }
      expect(pendingWrite).toBe(false);

      const first = await page(frozen.export_id, { limit: 200 });
      const rest = await execute({ ...ctx }, 'read_export', {
        ...selection,
        export_id: frozen.export_id,
        cursor: first.next_cursor,
      });
      expect(first.data.map((r: any) => r.id)).toEqual(expected.data.map((r: any) => r.id));
      expect(rest.data).toHaveLength(9);
      expect(
        rest.data.map((r: any) => ({
          id: r.id,
          display_name: r.display_name,
          revision: r.revision,
        })),
      ).toEqual(
        expectedTail.data.map((r: any) => ({
          id: r.id,
          display_name: r.display_name,
          revision: r.revision,
        })),
      );
      expect(rest.next_cursor).toBeNull();
      expect(new Set([...first.data, ...rest.data].map((r) => r.id)).size).toBe(209);
      expect(frozen.matching_count).toBe(209);
      expect(frozen.summary).toEqual(expected.summary);
    });

    it('QUERY04 matches existing item filters and catalog filters, including path and hidden scope', async () => {
      for (const input of [
        {
          kind: 'ITEM',
          query: {
            search: ' ＦＲＯＺＥＮ  ',
            profile: 'DURABLE',
            capabilities: ['asset'],
            catalog_node_ids: [sku],
            include_path: true,
            sort: { field: 'updated_at', direction: 'asc' },
          },
        },
        {
          kind: 'ITEM',
          query: {
            attribute_filters: [
              { template_id: 'asset', path: 'vendor', op: 'eq', value: 'Public vendor' },
            ],
          },
        },
        {
          kind: 'CATALOG_NODE',
          query: {
            kind: 'SKU',
            include_hidden: true,
            include_path: true,
            sort: { field: 'name', direction: 'asc' },
          },
        },
      ] as BeginExport[]) {
        const live = await execute(
          ctx,
          input.kind === 'ITEM' ? 'query_items' : 'query_catalog_nodes',
          input.query,
        );
        const frozen = await begin(input);
        const result = await page(frozen.export_id, {}, input);
        expect(result.data.map((r: any) => r.id)).toEqual(live.data.map((r: any) => r.id));
        expect(result.summary).toEqual(live.summary);
        expect(result.data.map((r: any) => r.path_ids)).toEqual(
          live.data.map((r: any) => r.path_ids),
        );
      }
    });

    it('QUERY04 empty results and households without a sync generation are supported', async () => {
      const empty = { ...(await transaction((c) => createHousehold(c))), source: 'TEST' };
      const frozen = await execute(empty, 'begin_export', { kind: 'ITEM' });
      expect(frozen.matching_count).toBe(0);
      expect(frozen.as_of_change_id).toBe('0');
      expect(await page(frozen.export_id, {}, { kind: 'ITEM' }, empty)).toMatchObject({
        data: [],
        next_cursor: null,
      });
    });

    it('QUERY05 rejects modified, malformed, swapped and out-of-bounds cursor payloads', async () => {
      const a = await begin(),
        b = await begin();
      const first = await page(a.export_id, { limit: 1 });
      const [body, signature] = first.next_cursor.split('.');
      const decoded = JSON.parse(Buffer.from(body, 'base64url').toString());
      for (const token of [
        'invalid',
        first.next_cursor + '.extra',
        body + '.' + signature.slice(1),
        Buffer.from(JSON.stringify({ ...decoded, ordinal: 99999 })).toString('base64url') +
          '.' +
          signature,
      ])
        await stale(page(a.export_id, { cursor: token }));
      await stale(page(b.export_id, { cursor: first.next_cursor }));
      await stale(page('export_' + randomUUID()));
    });

    it('QUERY05 binds kind, filters, sort, disclosure, generation and explicit hash on every page', async () => {
      const frozen = await begin();
      const first = await page(frozen.export_id, { limit: 1 });
      for (const extra of [
        { kind: 'CATALOG_NODE' },
        { query: { search: 'changed' } },
        { query: { sort: { field: 'name', direction: 'desc' } } },
        { query: { unknown_filter: true } },
        { include_sensitive: true },
        { generation: randomUUID() },
        { query_hash: '0'.repeat(64) },
      ])
        await stale(page(frozen.export_id, { cursor: first.next_cursor, ...extra }));
      await query(pool, 'SELECT reset_household_sync($1)', [ctx.household_id]);
      await stale(page(frozen.export_id));
    });

    it('QUERY05 refuses cross-household/actor reads and cancellation; rechecks actor existence', async () => {
      const frozen = await begin();
      const other = { ...(await transaction((c) => createHousehold(c))), source: 'TEST' };
      const actor = 'actor_' + randomUUID();
      await query(pool, 'INSERT INTO actors(id,household_id,name) VALUES($1,$2,$3)', [
        actor,
        ctx.household_id,
        'Other actor',
      ]);
      for (const outsider of [other, { ...ctx, actor_id: actor }]) {
        await stale(page(frozen.export_id, {}, selection, outsider));
        expect(
          await execute(outsider, 'cancel_export', { export_id: frozen.export_id }),
        ).toMatchObject({ cancelled: false });
      }
      await expect(
        page(frozen.export_id, {}, selection, { ...ctx, actor_id: 'actor_' + randomUUID() }),
      ).rejects.toMatchObject({ code: 'FORBIDDEN' });
      expect((await page(frozen.export_id)).data).toHaveLength(4);
    });

    it('QUERY05 enforces one-hour expiry without cleanup and scopes cleanup/cancel with cascading row release', async () => {
      const frozen = await begin();
      const duration = (
        await query(
          pool,
          'SELECT extract(epoch FROM expires_at-created_at)::integer AS ttl FROM frozen_exports WHERE id=$1',
          [frozen.export_id],
        )
      ).rows[0].ttl;
      expect(duration).toBe(3600);
      const other = { ...(await transaction((c) => createHousehold(c))), source: 'TEST' };
      const foreign = await execute(other, 'begin_export', {
        kind: 'CATALOG_NODE',
        query: { include_hidden: true },
      });
      await query(
        pool,
        "UPDATE frozen_exports SET expires_at=now()-interval '1 second' WHERE id=ANY($1::text[])",
        [[frozen.export_id, foreign.export_id]],
      );
      await stale(page(frozen.export_id));
      expect(await cleanupExports(ctx)).toEqual({ removed: 1 });
      expect(
        (
          await query(pool, 'SELECT * FROM frozen_export_rows WHERE export_id=$1', [
            frozen.export_id,
          ])
        ).rows,
      ).toEqual([]);
      expect(
        (await query(pool, 'SELECT * FROM frozen_exports WHERE id=$1', [foreign.export_id])).rows,
      ).toHaveLength(1);
      const active = await begin();
      expect(await execute(ctx, 'cancel_export', { export_id: active.export_id })).toMatchObject({
        cancelled: true,
      });
      expect(await execute(ctx, 'cancel_export', { export_id: active.export_id })).toMatchObject({
        cancelled: false,
      });
      await stale(page(active.export_id));
      expect(
        (
          await query(pool, 'SELECT * FROM frozen_export_rows WHERE export_id=$1', [
            active.export_id,
          ])
        ).rows,
      ).toEqual([]);
    });

    it('QUERY05 omits declared SENSITIVE/SECRET paths in stored default rows and audits explicit disclosure', async () => {
      // Publish a stronger declaration at creation: template definitions are append-only.
      const prior = ctx;
      ctx = {
        household_id: 'household_' + randomUUID(),
        actor_id: 'actor_' + randomUUID(),
        source: 'TEST',
      };
      const nextSku = 'catalog_node_' + randomUUID();
      await transaction(async (c) => {
        await query(
          c,
          "INSERT INTO households(id,name,timezone) VALUES($1,'Secret fixture','Asia/Shanghai')",
          [ctx.household_id],
        );
        await query(c, "INSERT INTO actors(id,household_id,name) VALUES($1,$2,'Fixture')", [
          ctx.actor_id,
          ctx.household_id,
        ]);
        await query(
          c,
          `INSERT INTO attribute_templates(household_id,id,version,target_kind,definition)
          SELECT $1,id,version,target_kind,CASE WHEN id='asset' AND version=1 THEN
          jsonb_set(definition,'{fields}',(SELECT jsonb_agg(CASE WHEN f->>'path'='vendor'
            THEN f || '{"sensitivity":"SECRET"}'::jsonb ELSE f END)
            FROM jsonb_array_elements(definition->'fields') f)) ELSE definition END
          FROM attribute_templates WHERE household_id=$2`,
          [ctx.household_id, prior.household_id],
        );
        await query(
          c,
          `INSERT INTO catalog_nodes(id,household_id,kind,name,profile)
          VALUES($1,$2,'SKU','Secret fixture','DURABLE')`,
          [nextSku, ctx.household_id],
        );
      });
      await write('create_items', {
        catalog_node_id: nextSku,
        count: 1,
        initial_attributes: [
          {
            template_id: 'asset',
            template_version: 1,
            values: { serial_no: 'PRIVATE-SERIAL', vendor: 'Public vendor' },
          },
        ],
      });
      const before = await inventory();
      const ordinary = await begin();
      const safe = await page(ordinary.export_id);
      const stored = (
        await query(pool, 'SELECT data FROM frozen_export_rows WHERE export_id=$1', [
          ordinary.export_id,
        ])
      ).rows;
      for (const value of [safe, stored]) {
        expect(JSON.stringify(value)).not.toContain('PRIVATE-');
        expect(JSON.stringify(value)).not.toContain('Public vendor');
      }
      expect(safe.data[0].redacted_paths).toContain('attributes.0.values.serial_no');
      expect(
        (
          await query(pool, 'SELECT * FROM sensitive_access_audit WHERE household_id=$1', [
            ctx.household_id,
          ])
        ).rows,
      ).toEqual([]);
      const explicit = { ...selection, include_sensitive: true };
      const sensitive = await begin(explicit);
      await stale(page(sensitive.export_id));
      const revealed = await page(sensitive.export_id, {}, explicit);
      expect(JSON.stringify(revealed)).toContain('PRIVATE-SERIAL');
      expect(JSON.stringify(revealed)).toContain('Public vendor');
      expect(revealed.data[0].redacted_paths).toEqual([]);
      const audit = (
        await query(
          pool,
          'SELECT actor_id,target_kind,target_id,scope FROM sensitive_access_audit WHERE household_id=$1',
          [ctx.household_id],
        )
      ).rows;
      expect(audit).toEqual(
        Array(2).fill({
          actor_id: ctx.actor_id,
          target_kind: 'EXPORT',
          target_id: sensitive.export_id,
          scope: 'export',
        }),
      );
      expect(await inventory()).toEqual(before);
    });

    it('QUERY05 unknown bindings are withheld by default, and a failed audit rolls back the frozen set', async () => {
      await query(
        pool,
        `UPDATE items SET attributes=attributes || '[{"template_id":"future-private","template_version":99,"values":{"secret":"FUTURE-SECRET"}}]'::jsonb WHERE id=$1`,
        [items[0]],
      );
      const frozen = await begin();
      expect(JSON.stringify(await page(frozen.export_id))).not.toContain('FUTURE-SECRET');
      const before = (
        await query(
          pool,
          'SELECT count(*)::integer AS n FROM frozen_exports WHERE household_id=$1',
          [ctx.household_id],
        )
      ).rows[0].n;
      // A trigger simulates durable audit failure for this household only; always remove it.
      await query(
        pool,
        `CREATE FUNCTION test_export_audit_failure() RETURNS trigger LANGUAGE plpgsql AS $$
      BEGIN IF NEW.household_id='${ctx.household_id}' THEN RAISE EXCEPTION 'test audit unavailable'; END IF; RETURN NEW; END $$`,
      );
      await query(
        pool,
        'CREATE TRIGGER test_export_audit_failure BEFORE INSERT ON sensitive_access_audit FOR EACH ROW EXECUTE FUNCTION test_export_audit_failure()',
      );
      try {
        await expect(begin({ ...selection, include_sensitive: true })).rejects.toThrow();
        expect(
          (
            await query(
              pool,
              'SELECT count(*)::integer AS n FROM frozen_exports WHERE household_id=$1',
              [ctx.household_id],
            )
          ).rows[0].n,
        ).toBe(before);
      } finally {
        await query(pool, 'DROP TRIGGER test_export_audit_failure ON sensitive_access_audit');
        await query(pool, 'DROP FUNCTION test_export_audit_failure()');
      }
    });

    it('QUERY04/05 begin/read/cancel/cleanup never write inventory, events, operations or sync changes', async () => {
      const before = await inventory();
      const frozen = await begin();
      await page(frozen.export_id, { limit: 1 });
      await execute(ctx, 'cancel_export', { export_id: frozen.export_id });
      const expired = await begin();
      await query(
        pool,
        "UPDATE frozen_exports SET expires_at=now()-interval '1 second' WHERE id=$1",
        [expired.export_id],
      );
      await cleanupExports(ctx);
      expect(await inventory()).toEqual(before);
    });

    it('QUERY05 authenticated POST read transport and HTTP CURSOR_STALE mapping work without public links', async () => {
      const app = await buildApp(ctx, 'export-test-token', false);
      const headers = {
        authorization: 'Bearer export-test-token',
        origin: 'http://localhost:80',
        'x-acornary-request': 'web',
        'x-acornary-protocol': '2',
      };
      try {
        const request = {
          method: 'POST' as const,
          url: '/api/read/begin_export',
          payload: selection,
        };
        expect((await app.inject(request)).statusCode).toBe(401);
        for (const url of ['/api/read/read_export', '/api/read/%72ead_export'])
          expect((await app.inject({ url })).statusCode).toBe(401);
        expect(
          (await app.inject({ ...request, headers: { ...headers, authorization: 'Bearer wrong' } }))
            .statusCode,
        ).toBe(401);
        expect(
          (await app.inject({ ...request, headers: { ...headers, origin: 'http://evil.invalid' } }))
            .statusCode,
        ).toBe(403);
        expect(
          (await app.inject({ ...request, headers: { ...headers, 'x-acornary-request': '' } }))
            .statusCode,
        ).toBe(403);

        const start = await app.inject({ ...request, headers });
        expect(start.statusCode, start.body).toBe(200);
        const frozen = start.json();
        expect(frozen).not.toHaveProperty('url');
        expect(frozen).not.toHaveProperty('cursor_secret');
        const result = await app.inject({
          method: 'POST',
          url: '/api/read/read_export',
          headers,
          payload: { ...selection, export_id: frozen.export_id, limit: 1 },
        });
        expect(result.statusCode, result.body).toBe(200);
        expect(result.json().data).toHaveLength(1);
        const rejected = await app.inject({
          method: 'POST',
          url: '/api/read/read_export',
          headers,
          payload: { ...selection, export_id: frozen.export_id, cursor: 'tampered' },
        });
        expect(rejected.statusCode).toBe(409);
        expect(rejected.json().error.code).toBe('CURSOR_STALE');
        const cancel = await app.inject({
          method: 'POST',
          url: '/api/read/cancel_export',
          headers,
          payload: { export_id: frozen.export_id },
        });
        expect(cancel.json().cancelled).toBe(true);
      } finally {
        await app.close();
      }
    });
  },
);
