import { beforeAll, afterAll, describe, expect, it, vi } from 'vitest';
import { randomUUID } from 'node:crypto';
import { performance } from 'node:perf_hooks';
import { execute, normalizeQuerySearch, type Context } from '../../apps/server/src/service.js';
import * as db from '../../apps/server/src/db.js';

// Requires an already migrated isolated test DB. Never starts a server or runs migrations.
const enabled = Boolean(process.env.DATABASE_URL);
const id = (kind: string) => `${kind}_${randomUUID()}`;
const binding = (template_id: string, values: any) => ({
  template_id,
  template_version: 1,
  values,
  created_at: '2026-01-01T00:00:00Z',
  updated_at: '2026-01-01T00:00:00Z',
});
let ctx: Context, sku: string, otherSku: string;
let items: string[];
const run = (input: any = {}) => execute(ctx, 'query_items', input);
async function item(
  catalog: string,
  attributes: any[],
  name: string | null = null,
  parent: string | null = null,
) {
  const itemId = id('item');
  await db.query(
    db.pool,
    `INSERT INTO items(id,household_id,catalog_node_id,display_name,parent_id,attributes,created_at,updated_at)
    VALUES($1,$2,$3,$4,$5,$6::jsonb,'2026-01-01 00:00:00.123456Z','2026-01-01 00:00:00.123456Z')`,
    [itemId, ctx.household_id, catalog, name, parent, JSON.stringify(attributes)],
  );
  return itemId;
}
describe.skipIf(!enabled)('Batch 2 migrated PostgreSQL queries', () => {
  beforeAll(async () => {
    if (!process.env.DATABASE_URL!.includes('acornary_test'))
      throw new Error('Use an isolated acornary_test database.');
    await db.query(db.pool, "SELECT acornary_normalize_search('ＭＩＬＫ')");
    ctx = { household_id: id('household'), actor_id: id('actor'), source: 'TEST' };
    await db.query(
      db.pool,
      "INSERT INTO households(id,name,timezone) VALUES($1,'query fixture','Asia/Shanghai')",
      [ctx.household_id],
    );
    await db.query(
      db.pool,
      "INSERT INTO actors(id,household_id,name) VALUES($1,$2,'query fixture')",
      [ctx.actor_id, ctx.household_id],
    );
    sku = id('catalog_node');
    otherSku = id('catalog_node');
    await db.query(
      db.pool,
      `INSERT INTO catalog_nodes(id,household_id,kind,name,attributes) VALUES
      ($1,$3,'SKU','  ＭＩＬＫ　牛奶  ',$4::jsonb),($2,$3,'SKU','other','[]')`,
      [
        sku,
        otherSku,
        ctx.household_id,
        JSON.stringify([
          binding('product', {
            brand: 'Brand Ａ',
            model: 'Model\t X',
            specification: '250  mL',
            barcodes: ['B-123'],
          }),
          binding('catalog', { visibility: 'HIDDEN' }),
        ]),
      ],
    );
    await db.query(
      db.pool,
      'INSERT INTO barcode_index(household_id,barcode,catalog_node_id) VALUES($1,$2,$3)',
      [ctx.household_id, 'B-123', sku],
    );
    items = [
      await item(
        sku,
        [
          binding('lifecycle', {
            state: 'ACTIVE',
            availability: 'AVAILABLE',
            expiry: { date: '2026-12-01', date_kind: 'USE_BY' },
          }),
          binding('contents', { remaining: { value: '1.25', unit: 'g' }, accuracy: 'MEASURED' }),
        ],
        'Custom Label',
      ),
      await item(sku, [binding('contents', { remaining: { value: '2.75', unit: 'g' } })]),
      await item(sku, [binding('contents', { remaining: { value: '60', unit: 'percent' } })]),
      await item(sku, []),
      await item(sku, [
        binding('lifecycle', { state: 'DISPOSED', availability: 'AVAILABLE' }),
        binding('contents', { remaining: { value: '100', unit: 'g' } }),
      ]),
    ];
    await db.query(
      db.pool,
      `INSERT INTO notes(id,household_id,item_id,body,created_by)
      VALUES($1,$2,$3,'ＮＯＴＥ　\t牛奶  100%_literal',$4)`,
      [id('note'), ctx.household_id, items[0], ctx.actor_id],
    );
  });
  afterAll(async () => {
    if (enabled) await db.pool.end();
  });
  it('QUERY01/03 aggregates the whole matching set, including items of hidden SKUs', async () => {
    const r = await run({ search: '牛奶', limit: 1 });
    expect(r.data).toHaveLength(1);
    expect(r).toMatchObject({
      matching_count: 5,
      current_count: 4,
      unknown_lifecycle_count: 3,
      unknown_availability_count: 3,
      content_totals: {
        by_unit: {
          g: { value: '4', measured_count: 1, estimated_count: 0, unknown_accuracy_count: 1 },
        },
        unknown_quantity_count: 1,
        unconvertible_percentage_count: 1,
      },
    });
    expect(r.summary.matching_count).toBe(r.matching_count);
    expect(typeof r.summary.as_of_change_id).toBe('string');
    const available = await run({
      attribute_filters: [
        { template_id: 'lifecycle', path: 'availability', op: 'eq', value: 'AVAILABLE' },
      ],
    });
    expect(available.data.map((r: any) => r.id)).toEqual([items[0]]);
    expect((await execute(ctx, 'query_catalog_nodes', { name: '牛奶' })).matching_count).toBe(0);
    expect(
      (await execute(ctx, 'query_catalog_nodes', { name: '牛奶', include_hidden: true }))
        .matching_count,
    ).toBe(1);
  });
  it('QUERY01/06 searches the same normalized item/SKU/product/note fields with literal wildcards', async () => {
    for (const search of [
      '  ｍｉｌｋ\t牛奶 ',
      '牛奶',
      'ｂｒａｎｄ a',
      'model  x',
      '250\tmL',
      'b-123',
      sku,
    ])
      expect((await run({ search })).matching_count).toBe(5);
    for (const search of ['custom label', 'note  牛奶', '100%_literal', items[0]])
      expect((await run({ search })).data.map((r: any) => r.id)).toEqual([items[0]]);
    expect((await run({ barcode: 'B-123' })).matching_count).toBe(5);
    for (const raw of ['  ＭＩＬＫ\t 牛奶\n', '\uFEFF奶\u3000粉\u00a0', 'É\t\tΣ', 'ΟΣ']) {
      const sql = (await db.query(db.pool, 'SELECT acornary_normalize_search($1) AS value', [raw]))
        .rows[0].value;
      expect(sql).toBe(normalizeQuerySearch(raw));
    }
  });
  it('QUERY02 keysets equal timestamps, rejects mismatches and preserves household scope', async () => {
    const seen: string[] = [];
    let cursor: string | undefined;
    do {
      const page = await run({ limit: 2, cursor });
      seen.push(...page.data.map((r: any) => r.id));
      cursor = page.next_cursor ?? undefined;
    } while (cursor);
    expect(seen).toEqual([...items].sort().reverse());
    const first = await run({ limit: 1 });
    await expect(run({ cursor: first.next_cursor, name: 'changed' })).rejects.toMatchObject({
      code: 'INVALID_CURSOR',
    });
    const other = { household_id: id('household'), actor_id: id('actor'), source: 'TEST' };
    await db.query(db.pool, "INSERT INTO households(id,name,timezone) VALUES($1,'other','UTC')", [
      other.household_id,
    ]);
    await db.query(db.pool, "INSERT INTO actors(id,household_id,name) VALUES($1,$2,'other')", [
      other.actor_id,
      other.household_id,
    ]);
    await expect(
      execute(other, 'query_items', { cursor: first.next_cursor }),
    ).rejects.toMatchObject({ code: 'INVALID_CURSOR' });
    expect((await execute(other, 'query_items', {})).matching_count).toBe(0);
  });
  it('QUERY02/03 continues after insert and sort-key edits and reports the new watermark', async (t) => {
    const present = (
      await db.query(db.pool, "SELECT to_regclass('household_sync_state') IS NOT NULL AS present")
    ).rows[0].present;
    if (!present) {
      t.skip('Requires the sync lane household_sync_state migration.');
      return;
    }
    await db.query(
      db.pool,
      `INSERT INTO household_sync_state(household_id,sync_generation,last_committed_change_id,pruned_through_change_id)
      VALUES($1,$2,1,0) ON CONFLICT(household_id) DO UPDATE SET last_committed_change_id=1`,
      [ctx.household_id, randomUUID()],
    );
    const input = {
      catalog_node_ids: [sku],
      limit: 1,
      sort: { field: 'updated_at', direction: 'desc' },
    };
    const first = await run(input);
    const inserted = await item(sku, [], 'inserted after first page');
    await db.query(
      db.pool,
      'UPDATE items SET updated_at=now() WHERE household_id=$1 AND id=ANY($2::text[])',
      [ctx.household_id, [inserted, first.data[0].id]],
    );
    await db.query(
      db.pool,
      'UPDATE household_sync_state SET last_committed_change_id=2 WHERE household_id=$1',
      [ctx.household_id],
    );
    const second = await run({ ...input, cursor: first.next_cursor });
    expect(second).toMatchObject({
      stale: true,
      as_of_change_id: '1',
      summary: { as_of_change_id: '2', matching_count: 6 },
    });
    expect(second.data.some((r: any) => r.id === first.data[0].id)).toBe(false);
  });
  it('catalog kind, subtree, attribute filters and keysets remain household scoped', async () => {
    const group = id('catalog_node');
    await db.query(
      db.pool,
      "INSERT INTO catalog_nodes(id,household_id,kind,name) VALUES($1,$2,'GROUP','query group')",
      [group, ctx.household_id],
    );
    await db.query(
      db.pool,
      'UPDATE catalog_nodes SET parent_id=$1 WHERE household_id=$2 AND id=ANY($3::text[])',
      [group, ctx.household_id, [sku, otherSku]],
    );
    const input = {
      catalog_subtree_id: group,
      include_hidden: true,
      include_path: true,
      kind: 'SKU',
      sort: { field: 'name', direction: 'asc' },
      limit: 1,
    };
    const first = await execute(ctx, 'query_catalog_nodes', input);
    expect(first.matching_count).toBe(2);
    expect(first.data[0].path_ids).toEqual([group, first.data[0].id]);
    const second = await execute(ctx, 'query_catalog_nodes', {
      ...input,
      cursor: first.next_cursor,
    });
    expect(new Set([first.data[0].id, second.data[0].id])).toEqual(new Set([sku, otherSku]));
    expect(second.next_cursor).toBeNull();
    const filtered = await execute(ctx, 'query_catalog_nodes', {
      ...input,
      attribute_filters: [{ template_id: 'product', path: 'brand', op: 'eq', value: 'Brand Ａ' }],
    });
    expect(filtered.data.map((r: any) => r.id)).toEqual([sku]);
    const empty = await run({ catalog_node_ids: [] });
    expect(empty).toMatchObject({
      matching_count: 0,
      current_count: 0,
      content_totals: { by_unit: {} },
      data: [],
      next_cursor: null,
    });
  });
  it('QUERY07 matches date kind and range within one binding entry', async () => {
    // Corrupt legacy duplicate bindings deliberately distinguish same-entry matching from independent EXISTS.
    const bad = await item(otherSku, [
      binding('lifecycle', { expiry: { date_kind: 'USE_BY', date: '2027-06-01' } }),
      binding('lifecycle', { expiry: { date_kind: 'BEST_BEFORE', date: '2026-12-01' } }),
    ]);
    const r = await run({
      attribute_filters: [
        { template_id: 'lifecycle', path: 'expiry.date_kind', op: 'eq', value: 'USE_BY' },
        { template_id: 'lifecycle', path: 'expiry.date', op: 'gte', value: '2026-01-01' },
        { template_id: 'lifecycle', path: 'expiry.date', op: 'lte', value: '2026-12-31' },
      ],
    });
    expect(r.data.map((r: any) => r.id)).toEqual([items[0]]);
    expect(r.data.some((r: any) => r.id === bad)).toBe(false);
  });
  it('pages date nulls last in both directions and batches paths, notes and timezone', async () => {
    const parent = await item(otherSku, [binding('container', { can_contain: true })], 'parent');
    const child = await item(
      otherSku,
      [
        binding('lifecycle', {
          opening: { opened_at: '2026-01-01T20:00:00Z' },
          expiry: { after_opening_days: 1 },
        }),
      ],
      'child',
      parent,
    );
    const scoped = await run({
      within_item_id: parent,
      include_path: true,
      sort: { field: 'reminder_date', direction: 'desc' },
      limit: 1,
    });
    expect(scoped.data[0]).toMatchObject({
      id: child,
      path_ids: [parent, child],
      reminder: { date: '2026-01-03' },
      notes: [],
    });
    const second = await run({
      within_item_id: parent,
      include_path: true,
      sort: { field: 'reminder_date', direction: 'desc' },
      cursor: scoped.next_cursor,
      limit: 1,
    });
    expect(second.data.map((r: any) => r.id)).toEqual([parent]);
    const asc = await run({
      within_item_id: parent,
      sort: { field: 'reminder_date', direction: 'asc' },
      limit: 1,
    });
    expect(asc.data[0].id).toBe(child);
    const named = await run({
      within_item_id: parent,
      sort: { field: 'name', direction: 'asc' },
      limit: 1,
    });
    expect(named.data[0].id).toBe(child);
    const namedNext = await run({
      within_item_id: parent,
      sort: { field: 'name', direction: 'asc' },
      limit: 1,
      cursor: named.next_cursor,
    });
    expect(namedNext.data[0].id).toBe(parent);
    const note = await run({ search: items[0], include_path: true });
    expect(note.data[0].notes).toHaveLength(1);
    expect(note.data[0].attributes[0]).not.toHaveProperty('created_at');
    await expect(run({ within_item_id: id('item') })).rejects.toMatchObject({ code: 'NOT_FOUND' });
  });
  it('history filters and keysets preserve timestamp microseconds', async () => {
    const op = id('operation');
    const events = [id('event'), id('event'), id('event')];
    await db.transaction(async (c) => {
      await db.query(
        c,
        `INSERT INTO operations(household_id,actor_id,idempotency_key,fingerprint,result)
        VALUES($1,$2,$3,'query-fixture',$4::jsonb)`,
        [
          ctx.household_id,
          ctx.actor_id,
          randomUUID(),
          JSON.stringify({ operation_id: op, affected_objects: [], event_ids: events }),
        ],
      );
      for (let n = 0; n < events.length; n++)
        await db.query(
          c,
          `INSERT INTO events(id,household_id,target_kind,target_id,operation_id,
        event_type,before_revision,after_revision,changes,actor_id,source,occurred_at,recorded_at)
        VALUES($1,$2,'ITEM',$3,$4,$5,0,1,'[]',$6,'WEB',now(),$7::timestamptz)`,
          [
            events[n],
            ctx.household_id,
            items[0],
            op,
            n === 2 ? 'UPDATE' : 'CREATE',
            ctx.actor_id,
            `2026-01-01T00:00:00.12345${n}Z`,
          ],
        );
    });
    const input = {
      target: { kind: 'ITEM', id: items[0] },
      operation_id: op,
      event_type: 'CREATE',
      recorded_from: '2026-01-01T00:00:00Z',
      recorded_to: '2026-01-02T00:00:00Z',
      limit: 1,
    };
    const first = await execute(ctx, 'get_history', input);
    expect(first.data[0].id).toBe(events[1]);
    const second = await execute(ctx, 'get_history', { ...input, cursor: first.next_cursor });
    expect(second.data[0].id).toBe(events[0]);
    expect(second.next_cursor).toBeNull();
    expect((await execute(ctx, 'get_history', { ...input, event_type: 'DELETE' })).data).toEqual(
      [],
    );
  });
  it('QUERY08 captures the actual statement plan and constant SQL count (small fixture, not budget evidence)', async () => {
    const spy = vi.spyOn(db, 'query');
    try {
      const start = performance.now();
      await run({ search: '牛奶', include_path: true, limit: 2 });
      const elapsed = performance.now() - start;
      const calls = [...spy.mock.calls];
      expect(calls.length).toBeLessThanOrEqual(5); // SET, auth, watermark lookup(s), main query; BEGIN/COMMIT handled directly.
      const call = calls.find((c) => c[1].startsWith('WITH RECURSIVE'))!;
      const explain = await db.query(
        db.pool,
        'EXPLAIN (ANALYZE, BUFFERS, FORMAT JSON) ' + call[1],
        call[2],
      );
      console.info(
        'QUERY08 small-fixture SQL count (plus BEGIN/COMMIT)',
        calls.length,
        'elapsed_ms',
        elapsed,
        'EXPLAIN',
        JSON.stringify(explain.rows),
      );
      const indexes = (
        await db.query(
          db.pool,
          'SELECT indexname FROM pg_indexes WHERE schemaname=current_schema() AND indexname=ANY($1::text[])',
          [
            [
              'items_attributes_gin',
              'catalog_attributes_gin',
              'items_search_name_trgm',
              'catalog_search_name_trgm',
              'items_created_query',
              'items_updated_query',
              'notes_updated_query',
              'events_household_time',
              'catalog_kind_query',
            ],
          ],
        )
      ).rows;
      expect(indexes).toHaveLength(9);
    } finally {
      spy.mockRestore();
    }
  });
});
