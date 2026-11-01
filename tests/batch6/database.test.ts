import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { randomUUID } from 'node:crypto';
import { execute, type Context } from '../../apps/server/src/service.js';
import { pool, query, transaction } from '../../apps/server/src/db.js';
import { rebuildIdentityIndex } from '../../apps/server/src/intake.js';
import { readInventoryV2 } from '../../apps/server/src/web.js';
import { approvedExecute } from '../catalog-helpers.js';
import { catalogRuleSchema } from '../../packages/contracts/src/intake.js';
import type { Operation } from '../../packages/contracts/src/index.js';
const id = (kind: string) => `${kind}_${randomUUID()}`;
const attr = (template_id: string, values: any, template_version = 1) => ({
  template_id,
  template_version,
  values,
});
const stored = (a: any) => ({
  ...a,
  created_at: '2026-01-01T00:00:00Z',
  updated_at: '2026-01-01T00:00:00Z',
});
const values = (row: any, name: string) =>
  row.attributes.find((a: any) => a.template_id === name)?.values;
async function fixture() {
  const ctx: Context = { household_id: id('household'), actor_id: id('actor'), source: 'TEST' };
  await query(
    pool,
    "INSERT INTO households(id,name,timezone) VALUES($1,'semantics','Asia/Shanghai')",
    [ctx.household_id],
  );
  await query(pool, "INSERT INTO actors(id,household_id,name) VALUES($1,$2,'tester')", [
    ctx.actor_id,
    ctx.household_id,
  ]);
  const sku = await catalog(ctx);
  return { ctx, sku };
}
async function catalog(
  ctx: Context,
  attrs: any[] = [],
  name = 'fixture',
  kind = 'SKU',
  parent: string | null = null,
) {
  const sku = id('catalog_node');
  await query(
    pool,
    'INSERT INTO catalog_nodes(id,household_id,kind,name,parent_id,attributes) VALUES($1,$2,$3,$4,$5,$6::jsonb)',
    [sku, ctx.household_id, kind, name, parent, JSON.stringify(attrs.map(stored))],
  );
  return sku;
}
async function item(ctx: Context, sku: string, attrs: any[] = [], parent: string | null = null) {
  const itemId = id('item');
  await query(
    pool,
    'INSERT INTO items(id,household_id,catalog_node_id,parent_id,attributes) VALUES($1,$2,$3,$4,$5::jsonb)',
    [itemId, ctx.household_id, sku, parent, JSON.stringify(attrs.map(stored))],
  );
  return itemId;
}
const get = (ctx: Context, item_id: string) => execute(ctx, 'get_item', { item_id });
const write = (ctx: Context, name: Operation, input: any) =>
  approvedExecute(ctx, name, { idempotency_key: randomUUID(), ...input });
const update = (ctx: Context, item_id: string, revision: number, template_id: string, set: any) =>
  write(ctx, 'update_attributes', {
    target: { kind: 'ITEM', id: item_id },
    template_id,
    template_version: 1,
    set,
    expected_revisions: { [item_id]: revision },
  });
async function counts(ctx: Context) {
  return (
    await query(
      pool,
      `SELECT (SELECT count(*) FROM events WHERE household_id=$1)::int AS events,(SELECT count(*) FROM operations WHERE household_id=$1)::int AS operations,(SELECT count(*) FROM sync_changes WHERE household_id=$1)::int AS sync`,
      [ctx.household_id],
    )
  ).rows[0];
}

describe.skipIf(!process.env.DATABASE_URL)('Batch 6 migrated PostgreSQL', () => {
  beforeAll(() => {
    if (!process.env.DATABASE_URL?.endsWith('/acornary_test_w3_semantics'))
      throw new Error('Use the isolated Batch 6 database.');
  });
  afterAll(() => pool.end());
  it('MODEL04 disposition and DISPOSED share one event, preserve lifecycle v1, replay and reject bypass', async () => {
    const { ctx, sku } = await fixture(),
      itemId = await item(ctx, sku);
    await expect(update(ctx, itemId, 1, 'lifecycle', { state: 'DISPOSED' })).rejects.toMatchObject({
      code: 'STATE_CONFLICT',
    });
    const input = {
      item_id: itemId,
      disposition: {
        kind: 'GIFT',
        date: '2026-10-31',
        recipient: { kind: 'EXTERNAL', name: 'Neighbor' },
      },
      expected_revisions: { [itemId]: 1 },
      idempotency_key: randomUUID(),
    };
    const result = await execute(ctx, 'dispose_item', input);
    expect(result.event_ids).toHaveLength(1);
    expect(await execute(ctx, 'dispose_item', input)).toEqual(result);
    const row = await get(ctx, itemId);
    expect(values(row, 'disposition')).toEqual(input.disposition);
    expect(row.attributes.find((a: any) => a.template_id === 'lifecycle')).toMatchObject({
      template_version: 1,
      values: { state: 'DISPOSED' },
    });
    expect((await execute(ctx, 'query_items', {})).data).toHaveLength(0);
    expect((await execute(ctx, 'query_items', { include_terminal: true })).data).toHaveLength(1);
    expect(
      (
        await execute(ctx, 'get_history', { operation_id: result.operation_id })
      ).data[0].changes.map((c: any) => c.path),
    ).toContain('attributes.disposition.kind');
  });
  it('MODEL05 void excludes default reads, emits tombstone, restores with reason and retains history', async () => {
    const { ctx, sku } = await fixture(),
      itemId = await item(ctx, sku);
    await write(ctx, 'void_item', {
      item_id: itemId,
      reason: 'duplicate',
      expected_revisions: { [itemId]: 1 },
    });
    expect(await get(ctx, itemId)).toMatchObject({ record_state: 'VOID', revision: 2 });
    expect((await execute(ctx, 'query_items', {})).data).toHaveLength(0);
    expect((await execute(ctx, 'query_items', { include_void: true })).data).toHaveLength(1);
    expect((await transaction((c) => readInventoryV2(c, ctx.household_id))).items).toHaveLength(0);
    expect(
      (
        await query(
          pool,
          'SELECT change_kind FROM sync_changes WHERE household_id=$1 ORDER BY change_id DESC LIMIT 1',
          [ctx.household_id],
        )
      ).rows[0].change_kind,
    ).toBe('TOMBSTONE');
    await expect(
      write(ctx, 'update_item', {
        item_id: itemId,
        display_name: 'no',
        expected_revisions: { [itemId]: 2 },
      }),
    ).rejects.toMatchObject({ code: 'STATE_CONFLICT' });
    await write(ctx, 'correct_item', {
      item_id: itemId,
      reason: 'real item',
      record_state: 'VALID',
      expected_revisions: { [itemId]: 2 },
    });
    expect(await get(ctx, itemId)).toMatchObject({
      record_state: 'VALID',
      voided_at: null,
      revision: 3,
    });
    expect(
      (await execute(ctx, 'get_history', { target: { kind: 'ITEM', id: itemId } })).data,
    ).toHaveLength(2);
    expect(
      (
        await query(
          pool,
          'SELECT change_kind FROM sync_changes WHERE household_id=$1 ORDER BY change_id DESC LIMIT 1',
          [ctx.household_id],
        )
      ).rows[0].change_kind,
    ).toBe('UPSERT');
    await write(ctx, 'correct_item', {
      item_id: itemId,
      reason: 'archive historical record',
      attributes: [{ template_id: 'lifecycle', template_version: 1, set: { state: 'ARCHIVED' } }],
      expected_revisions: { [itemId]: 3 },
    });
    expect(
      (
        await query(
          pool,
          'SELECT change_kind FROM sync_changes WHERE household_id=$1 ORDER BY change_id DESC LIMIT 1',
          [ctx.household_id],
        )
      ).rows[0].change_kind,
    ).toBe('TOMBSTONE');
  });
  it('MODEL05 SKU void requires existing governance and rejects items, keys, barcodes, aliases, system refs', async () => {
    const { ctx, sku } = await fixture();
    const input = {
      catalog_node_id: sku,
      reason: 'mistake',
      expected_revisions: { [sku]: 1 },
      idempotency_key: randomUUID(),
    };
    await expect(execute(ctx, 'void_catalog_node', input)).rejects.toMatchObject({
      code: 'APPROVAL_REQUIRED',
    });
    await approvedExecute(ctx, 'void_catalog_node', input);
    expect((await execute(ctx, 'query_catalog_nodes', {})).data).toHaveLength(0);
    expect((await execute(ctx, 'query_catalog_nodes', { include_void: true })).data).toHaveLength(
      1,
    );
    for (const ref of ['item', 'barcode', 'identity', 'system', 'alias', 'reverse']) {
      const node = await catalog(ctx, [], ref);
      if (ref === 'item') await item(ctx, node);
      if (ref === 'barcode')
        await query(
          pool,
          'INSERT INTO barcode_index(household_id,barcode,catalog_node_id) VALUES($1,$2,$3)',
          [ctx.household_id, randomUUID(), node],
        );
      if (ref === 'identity')
        await query(
          pool,
          'INSERT INTO catalog_identity_keys(household_id,identity_key,catalog_node_id,policy_revision) VALUES($1,$2,$3,0)',
          [ctx.household_id, randomUUID(), node],
        );
      if (ref === 'system')
        await query(
          pool,
          'INSERT INTO household_settings(household_id,container_catalog_id) VALUES($1,$2)',
          [ctx.household_id, node],
        );
      if (ref === 'alias')
        await query(
          pool,
          "INSERT INTO catalog_policy_versions(household_id,revision,rules,actor_id,reason) VALUES($1,1,$2::jsonb,$3,'fixture')",
          [
            ctx.household_id,
            JSON.stringify([{ aliases: [{ name: 'alias', catalog_node_id: node }] }]),
            ctx.actor_id,
          ],
        );
      if (ref === 'reverse') {
        const i = await item(ctx, node);
        await update(ctx, i, 1, 'custody', { owner: { kind: 'CATALOG_NODE', id: node } });
      }
      await expect(
        write(ctx, 'void_catalog_node', {
          catalog_node_id: node,
          reason: 'blocked',
          expected_revisions: { [node]: 1 },
        }),
      ).rejects.toMatchObject({ code: 'STATE_CONFLICT' });
    }
  });
  it('MODEL05 rejects voiding containers with children', async () => {
    const { ctx, sku } = await fixture(),
      parent = await item(ctx, sku, [attr('container', { can_contain: true })]);
    await item(ctx, sku, [], parent);
    await expect(
      write(ctx, 'void_item', {
        item_id: parent,
        reason: 'no',
        expected_revisions: { [parent]: 1 },
      }),
    ).rejects.toMatchObject({ code: 'STATE_CONFLICT' });
  });
  it('MODEL06 count split is atomic, retry-safe, linked, and cannot restore or repeat source', async () => {
    const { ctx, sku } = await fixture(),
      source = await item(ctx, sku, [
        attr('contents', { remaining: { value: '3', unit: 'count' } }),
        attr('asset', { serial_no: 'SOURCE', price: { amount: '10', currency: 'CNY' } }),
        attr('lifecycle', { opening: { state: 'OPENED' } }),
      ]);
    const input = {
      source_item_id: source,
      target_catalog_node_id: sku,
      count: 3,
      child_attributes: [attr('contents', { remaining: { value: '1', unit: 'count' } })],
      expected_revisions: { [source]: 1 },
      idempotency_key: randomUUID(),
    };
    const result = await execute(ctx, 'split_item', input);
    expect(result.children).toHaveLength(3);
    expect(result.event_ids).toHaveLength(4);
    expect(await execute(ctx, 'split_item', input)).toEqual(result);
    expect(values(await get(ctx, source), 'contents').remaining.value).toBe('0');
    for (const child of result.children) {
      const row = await get(ctx, child.item_id);
      expect(row.parent_id).toBeNull();
      expect(row.split.source_item_id).toBe(source);
      expect(values(row, 'asset')).toBeUndefined();
      expect(values(row, 'lifecycle')?.opening).toBeUndefined();
    }
    await expect(
      execute(ctx, 'split_item', {
        ...input,
        idempotency_key: randomUUID(),
        expected_revisions: { [source]: 2 },
      }),
    ).rejects.toMatchObject({ code: 'STATE_CONFLICT' });
    await expect(
      write(ctx, 'correct_item', {
        item_id: source,
        reason: 'undo',
        attributes: [{ template_id: 'lifecycle', template_version: 1, set: { state: 'ACTIVE' } }],
        expected_revisions: { [source]: 2 },
      }),
    ).rejects.toMatchObject({ code: 'STATE_CONFLICT' });
    await expect(
      write(ctx, 'void_item', {
        item_id: source,
        reason: 'hide',
        expected_revisions: { [source]: 2 },
      }),
    ).rejects.toMatchObject({ code: 'STATE_CONFLICT' });
    expect(
      (await query(pool, 'SELECT * FROM item_splits WHERE household_id=$1', [ctx.household_id]))
        .rows,
    ).toHaveLength(3);
  });
  it('MODEL06 content split conserves units and rolls back mismatches and invalid child references', async () => {
    const { ctx, sku } = await fixture(),
      source = await item(ctx, sku, [
        attr('contents', { remaining: { value: '1000', unit: 'mL' } }),
      ]);
    const base = {
      source_item_id: source,
      target_catalog_node_id: sku,
      count: 2,
      expected_revisions: { [source]: 1 },
    };
    const before = await counts(ctx);
    for (const q of [
      { value: '1', unit: 'count' },
      { value: '499', unit: 'mL' },
    ])
      await expect(
        write(ctx, 'split_item', {
          ...base,
          child_attributes: [attr('contents', { remaining: q })],
        }),
      ).rejects.toMatchObject({ code: 'SPLIT_NOT_CONSERVED' });
    await expect(
      write(ctx, 'split_item', {
        ...base,
        child_attributes: [
          attr('contents', { remaining: { value: '500', unit: 'mL' } }),
          attr('custody', { owner: { kind: 'ACTOR', id: id('actor') } }),
        ],
      }),
    ).rejects.toMatchObject({ code: 'REFERENCE_INVALID' });
    expect(await counts(ctx)).toEqual(before);
    expect((await get(ctx, source)).revision).toBe(1);
    const result = await write(ctx, 'split_item', {
      ...base,
      child_attributes: [attr('contents', { remaining: { value: '0.5', unit: 'L' } }, 2)],
    });
    expect(values(await get(ctx, result.children[0].item_id), 'contents').remaining).toEqual({
      value: '500',
      unit: 'mL',
    });
  });
  it('MODEL07 normalizes new quantities and preserves original input events and old fields', async () => {
    const { ctx, sku } = await fixture(),
      itemId = await item(ctx, sku, [
        attr('contents', { remaining: { value: '1.500', unit: 'g' } }),
      ]);
    const old = (await query(pool, 'SELECT attributes::text AS a FROM items WHERE id=$1', [itemId]))
      .rows[0].a;
    await write(ctx, 'update_item', {
      item_id: itemId,
      display_name: 'kept',
      expected_revisions: { [itemId]: 1 },
    });
    expect(
      (await query(pool, 'SELECT attributes::text AS a FROM items WHERE id=$1', [itemId])).rows[0]
        .a,
    ).toBe(old);
    const result = await write(ctx, 'upgrade_attributes', {
      target: { kind: 'ITEM', id: itemId },
      template_id: 'contents',
      from_version: 1,
      to_version: 2,
      values: { remaining: { value: '1.5', unit: 'kg' } },
      expected_revisions: { [itemId]: 2 },
    });
    expect(values(await get(ctx, itemId), 'contents').remaining).toEqual({
      value: '1500',
      unit: 'g',
    });
    const history = await execute(ctx, 'get_history', { operation_id: result.operation_id });
    expect(history.data[0].changes.find((c: any) => c.path === 'quantity_input').after).toEqual([
      { path: 'values.remaining', value: '1.5', unit: 'kg' },
    ]);
  });
  it('MODEL08 COUNT includes unknown lifecycle and excludes terminal/VOID, with scoped paging', async () => {
    const { ctx } = await fixture();
    const sku = await catalog(ctx, [
      attr('stock', { basis: 'COUNT', reorder_threshold: '3', target: '5' }),
    ]);
    await item(ctx, sku);
    await item(ctx, sku, [attr('lifecycle', { state: 'ACTIVE' })]);
    await item(ctx, sku, [attr('lifecycle', { state: 'CONSUMED' })]);
    const voided = await item(ctx, sku);
    await write(ctx, 'void_item', {
      item_id: voided,
      reason: 'duplicate',
      expected_revisions: { [voided]: 1 },
    });
    expect((await execute(ctx, 'query_stock', {})).data[0]).toMatchObject({
      basis: 'COUNT',
      unit: 'count',
      current_count: 2,
      current_content: null,
      unknown_count: 0,
      low: true,
      gap: '3',
    });
    const second = await catalog(ctx, [attr('stock', { basis: 'COUNT' })]);
    const page = await execute(ctx, 'query_stock', { limit: 1 });
    expect(page.matching_count).toBe(2);
    expect(page.next_cursor).toBeTruthy();
    const next = await execute(ctx, 'query_stock', { limit: 1, cursor: page.next_cursor });
    expect(next.data[0].catalog_node_id).not.toBe(page.data[0].catalog_node_id);
    await expect(
      execute(ctx, 'query_stock', { low_only: true, cursor: page.next_cursor }),
    ).rejects.toMatchObject({ code: 'INVALID_CURSOR' });
    expect(
      (await execute(ctx, 'query_stock', { catalog_node_ids: [second] })).data[0],
    ).toMatchObject({ low: null, gap: null, current_count: 0 });
  });
  it('MODEL08 CONTENT keeps unknown, percentages and incompatible units separate', async () => {
    const { ctx } = await fixture(),
      sku = await catalog(ctx, [
        attr('stock', {
          basis: 'CONTENT',
          content_unit: 'mL',
          reorder_threshold: '600',
          target: '1000',
        }),
      ]);
    await item(ctx, sku, [attr('contents', { remaining: { value: '500', unit: 'mL' } })]);
    await item(ctx, sku);
    await item(ctx, sku, [attr('contents', { remaining: { value: '50', unit: 'percent' } })]);
    await item(ctx, sku, [attr('contents', { remaining: { value: '10', unit: 'g' } })]);
    expect((await execute(ctx, 'query_stock', {})).data[0]).toMatchObject({
      current_count: null,
      current_content: '500',
      unknown_count: 3,
      low: null,
      gap: null,
    });
    expect((await execute(ctx, 'query_stock', { low_only: true })).data).toHaveLength(0);
    await item(ctx, sku, [attr('contents', { remaining: { value: '100', unit: 'mL' } })]);
    expect((await execute(ctx, 'query_stock', {})).data[0].low).toBe(false);
  });

  it('MODEL09 name-only candidates need selection; one_off is explicit, hidden from usual catalog and auto-match', async () => {
    const { ctx } = await fixture(),
      group = await catalog(ctx, [], 'personal', 'GROUP');
    const rule = catalogRuleSchema.parse({
      branch_id: group,
      meaning: 'personal things',
      boundaries: 'personal',
      subdivision_basis: 'type',
      allow_direct_products: true,
      allow_new_groups: false,
      max_new_depth: 0,
      naming_guidance: 'specific',
      identity_fields: ['product.brand', 'product.model'],
    });
    await query(
      pool,
      "INSERT INTO catalog_policy_versions(household_id,revision,rules,actor_id,reason) VALUES($1,1,$2::jsonb,$3,'fixture')",
      [ctx.household_id, JSON.stringify([rule]), ctx.actor_id],
    );
    const intake = async (product: any) =>
      (
        await write(ctx, 'commit_intake', {
          policy_revision: 1,
          expected_revisions: { [group]: 1 },
          lines: [{ product, instances: [{ count: 1 }] }],
        })
      ).receipt;
    const draft = {
      name: 'keepsake',
      parent_id: group,
      classification_reason: 'personal keepsake',
    };
    const first = await intake(draft);
    const original = first.created_catalog[0];
    expect(
      (
        await query(pool, 'SELECT * FROM catalog_identity_keys WHERE household_id=$1', [
          ctx.household_id,
        ])
      ).rows,
    ).toHaveLength(0);
    const before = await counts(ctx);
    await expect(intake(draft)).rejects.toMatchObject({ code: 'AMBIGUOUS_PRODUCT' });
    expect(await counts(ctx)).toEqual(before);
    const selected = await write(ctx, 'commit_intake', {
      policy_revision: 1,
      expected_revisions: { [original]: 1, [group]: 1 },
      lines: [{ product: { catalog_node_id: original }, instances: [{ count: 1 }] }],
    });
    expect(selected.receipt.created_catalog).toHaveLength(0);
    const one = await intake({ ...draft, one_off: true });
    const oneId = one.created_catalog[0];
    expect(
      (await execute(ctx, 'query_catalog_nodes', { name: 'keepsake' })).data.map((n: any) => n.id),
    ).toEqual([original]);
    expect(
      (await execute(ctx, 'query_catalog_nodes', { name: 'keepsake', include_one_off: true })).data,
    ).toHaveLength(2);
    expect((await execute(ctx, 'query_items', { catalog_node_ids: [oneId] })).data).toHaveLength(1);
    expect(
      (await execute(ctx, 'get_intake_context', { names: ['keepsake'] })).catalog.candidates.some(
        (n: any) => n.id === oneId,
      ),
    ).toBe(false);
    const complete = {
      name: 'device',
      parent_id: group,
      classification_reason: 'personal device',
      initial_attributes: [attr('product', { brand: 'Acme', model: 'M1' })],
    };
    const newDevice = await intake(complete);
    const reused = await intake(complete);
    expect(reused.created_catalog).toHaveLength(0);
    expect(reused.reused_catalog).toContain(newDevice.created_catalog[0]);
    const once = await intake({ ...complete, name: 'unique', one_off: true });
    const regular = await intake({ ...complete, name: 'unique' });
    expect(regular.created_catalog[0]).not.toBe(once.created_catalog[0]);
  });
  it('MODEL06 concurrent split requests cannot duplicate child inventory', async () => {
    const { ctx, sku } = await fixture(),
      source = await item(ctx, sku, [
        attr('contents', { remaining: { value: '2', unit: 'count' } }),
      ]);
    const input = {
      source_item_id: source,
      target_catalog_node_id: sku,
      count: 2,
      child_attributes: [attr('contents', { remaining: { value: '1', unit: 'count' } })],
      expected_revisions: { [source]: 1 },
    };
    const results = await Promise.allSettled([
      write(ctx, 'split_item', input),
      write(ctx, 'split_item', input),
    ]);
    expect(results.filter((r) => r.status === 'fulfilled')).toHaveLength(1);
    expect(
      (results.find((r) => r.status === 'rejected') as PromiseRejectedResult).reason.code,
    ).toBe('REVISION_CONFLICT');
    expect((await execute(ctx, 'query_items', {})).data).toHaveLength(2);
  });
  it('MODEL10 GROUP duplicate siblings rejected while SKU names may repeat', async () => {
    const { ctx } = await fixture();
    await catalog(ctx, [], 'Group Name', 'GROUP');
    await expect(
      write(ctx, 'create_catalog_node', {
        kind: 'GROUP',
        name: 'ＧＲＯＵＰ  NAME',
        parent_id: null,
      }),
    ).rejects.toMatchObject({ code: 'STATE_CONFLICT' });
    for (let n = 0; n < 2; n++)
      await write(ctx, 'create_catalog_node', { kind: 'SKU', name: 'same', parent_id: null });
    expect((await execute(ctx, 'query_catalog_nodes', { name: 'same' })).data).toHaveLength(2);
  });
  it('MODEL11 explicit clothing/device upgrades rebuild identity keys and report conflicts without merge', async () => {
    const { ctx } = await fixture();
    const group = await catalog(ctx, [], 'wear', 'GROUP');
    await query(
      pool,
      "INSERT INTO catalog_policy_versions(household_id,revision,rules,actor_id,reason) VALUES($1,1,$2::jsonb,$3,'fixture')",
      [
        ctx.household_id,
        JSON.stringify([{ branch_id: group, identity_fields: ['clothing.size'], aliases: [] }]),
        ctx.actor_id,
      ],
    );
    const first = await catalog(ctx, [attr('clothing', { size: 'L' })], 'shirt', 'SKU', group),
      second = await catalog(
        ctx,
        [attr('clothing', { size: { label: 'L', system: 'US' } }, 2)],
        'shirt',
        'SKU',
        group,
      );
    const rebuilt = await transaction((c) => rebuildIdentityIndex(c, ctx.household_id));
    expect(rebuilt.indexed).toBe(2);
    const result = await write(ctx, 'upgrade_attributes', {
      target: { kind: 'CATALOG_NODE', id: first },
      template_id: 'clothing',
      from_version: 1,
      to_version: 2,
      values: { size: { label: 'L', system: 'US' } },
      expected_revisions: { [first]: 1 },
    });
    expect(result.identity_conflicts[0].catalog_node_ids.sort()).toEqual([first, second].sort());
    expect(
      (
        await query(pool, 'SELECT * FROM catalog_identity_keys WHERE household_id=$1', [
          ctx.household_id,
        ])
      ).rows,
    ).toHaveLength(0);
    expect((await execute(ctx, 'query_catalog_nodes', { name: 'shirt' })).data).toHaveLength(2);
    const device = await catalog(ctx, [
      attr('device', { connector: 'USB-C', rated_power_w: '10' }),
    ]);
    await write(ctx, 'upgrade_attributes', {
      target: { kind: 'CATALOG_NODE', id: device },
      template_id: 'device',
      from_version: 1,
      to_version: 2,
      values: {
        connector: [{ type: 'USB-C', count: 1, role: 'INPUT' }],
        electrical: { rated_power: { value: '10', unit: 'W' } },
      },
      expected_revisions: { [device]: 1 },
    });
    expect(
      values(await execute(ctx, 'get_catalog_node', { catalog_node_id: device }), 'device')
        .connector[0].type,
    ).toBe('USB-C');
    const electricalRule = catalogRuleSchema.parse({
      branch_id: group,
      meaning: 'devices',
      boundaries: 'devices',
      subdivision_basis: 'type',
      allow_direct_products: true,
      allow_new_groups: false,
      max_new_depth: 0,
      naming_guidance: 'specific',
      identity_fields: ['device.electrical'],
    });
    await query(
      pool,
      "INSERT INTO catalog_policy_versions(household_id,revision,rules,actor_id,reason) VALUES($1,2,$2::jsonb,$3,'fixture')",
      [ctx.household_id, JSON.stringify([electricalRule]), ctx.actor_id],
    );
    const intake = (value: string, unit: string) =>
      write(ctx, 'commit_intake', {
        policy_revision: 2,
        expected_revisions: { [group]: 1 },
        lines: [
          {
            product: {
              name: 'battery',
              parent_id: group,
              classification_reason: 'device',
              initial_attributes: [attr('device', { electrical: { energy: { value, unit } } }, 2)],
            },
            instances: [{ count: 1 }],
          },
        ],
      });
    const original = await intake('1', 'kWh');
    const equivalent = await intake('1000', 'Wh');
    expect(equivalent.receipt.created_catalog).toHaveLength(0);
    expect(equivalent.receipt.reused_catalog).toContain(original.receipt.created_catalog[0]);
  });
  it('MODEL14 replaces reverse references atomically, rejects foreign/missing targets, external names create no actors', async () => {
    const { ctx, sku } = await fixture(),
      foreign = await fixture(),
      i = await item(ctx, sku),
      other = await item(ctx, sku);
    await update(ctx, i, 1, 'custody', {
      owner: { kind: 'ACTOR', id: ctx.actor_id },
      holder: { kind: 'ITEM', id: other },
    });
    expect(
      (await execute(ctx, 'query_references', { target: { kind: 'ACTOR', id: ctx.actor_id } }))
        .data,
    ).toHaveLength(1);
    expect(
      (await execute(ctx, 'query_references', { target: { kind: 'ITEM', id: other } })).data[0]
        .path,
    ).toBe('holder');
    await update(ctx, i, 2, 'custody', { owner: { kind: 'CATALOG_NODE', id: sku } });
    expect(
      (await execute(ctx, 'query_references', { target: { kind: 'ACTOR', id: ctx.actor_id } }))
        .data,
    ).toHaveLength(0);
    const before = await counts(ctx);
    for (const bad of [foreign.ctx.actor_id, id('actor')])
      await expect(
        update(ctx, i, 3, 'custody', { owner: { kind: 'ACTOR', id: bad } }),
      ).rejects.toMatchObject({ code: 'REFERENCE_INVALID' });
    expect(await counts(ctx)).toEqual(before);
    expect(
      (await execute(ctx, 'query_references', { target: { kind: 'CATALOG_NODE', id: sku } })).data,
    ).toHaveLength(1);
    await update(ctx, i, 3, 'custody', { owner: { kind: 'EXTERNAL', name: 'Neighbor' } });
    expect(
      (await execute(ctx, 'query_references', { target: { kind: 'CATALOG_NODE', id: sku } })).data,
    ).toHaveLength(0);
    expect(
      (
        await query(pool, 'SELECT count(*)::int AS n FROM actors WHERE household_id=$1', [
          ctx.household_id,
        ])
      ).rows[0].n,
    ).toBe(1);
  });
  it('MODEL08 stock scopes and stale cursors use full matching sets; profile/capability filters inherit defaults', async () => {
    const { ctx, sku } = await fixture(),
      other = await fixture();
    const group = await catalog(ctx, [], 'scope', 'GROUP');
    const stockSku = await catalog(
      ctx,
      [attr('stock', { basis: 'COUNT', reorder_threshold: '3', target: '4' })],
      'stock',
      'SKU',
      group,
    );
    await query(pool, "UPDATE catalog_nodes SET profile='CONSUMABLE' WHERE id=$1", [stockSku]);
    const container = await item(ctx, sku, [attr('container', { can_contain: true })]);
    await item(ctx, stockSku, [], container);
    await item(ctx, stockSku);
    await catalog(ctx, [attr('stock', { basis: 'COUNT' })]);
    const scoped = await execute(ctx, 'query_stock', {
      catalog_subtree_id: group,
      within_item_id: container,
    });
    expect(scoped.data).toHaveLength(1);
    expect(scoped.data[0]).toMatchObject({ current_count: 1, low: true, gap: '3' });
    const page = await execute(ctx, 'query_stock', { limit: 1 });
    await write(ctx, 'create_items', { catalog_node_id: stockSku, count: 1 });
    expect(await execute(ctx, 'query_stock', { limit: 1, cursor: page.next_cursor })).toMatchObject(
      { stale: true, as_of_change_id: page.as_of_change_id, matching_count: 2 },
    );
    await expect(
      execute(other.ctx, 'query_stock', { cursor: page.next_cursor }),
    ).rejects.toMatchObject({ code: 'INVALID_CURSOR' });
    const matches = await execute(ctx, 'query_items', {
      profile: 'CONSUMABLE',
      capabilities: ['contents', 'stock'],
    });
    expect(matches.matching_count).toBe(3);
    expect(matches.data[0].effective_capabilities).toContain('stock');
    expect(
      (
        await execute(ctx, 'query_catalog_nodes', {
          profile: 'CONSUMABLE',
          capabilities: ['stock'],
        })
      ).data,
    ).toHaveLength(1);
  });
  it('MODEL06 rejects copied sensitive/opening facts, containers, and direct zero-content terminal bypass', async () => {
    const { ctx, sku } = await fixture(),
      source = await item(ctx, sku, [
        attr('contents', { remaining: { value: '2', unit: 'count' } }),
      ]);
    const base = {
      source_item_id: source,
      target_catalog_node_id: sku,
      count: 2,
      expected_revisions: { [source]: 1 },
    };
    for (const forbidden of [
      attr('asset', { serial_no: 'SN' }),
      attr('asset', { price: { amount: '1', currency: 'USD' } }),
      attr('lifecycle', { opening: { state: 'SEALED' } }),
    ])
      await expect(
        write(ctx, 'split_item', {
          ...base,
          child_attributes: [
            attr('contents', { remaining: { value: '1', unit: 'count' } }),
            forbidden,
          ],
        }),
      ).rejects.toMatchObject({ code: 'STATE_CONFLICT' });
    await expect(
      update(ctx, source, 1, 'contents', { remaining: { value: '0', unit: 'count' } }),
    ).rejects.toMatchObject({ code: 'STATE_CONFLICT' });
    const parent = await item(ctx, sku, [
      attr('container', { can_contain: true }),
      attr('contents', { remaining: { value: '2', unit: 'count' } }),
    ]);
    await item(ctx, sku, [], parent);
    await expect(
      write(ctx, 'split_item', {
        ...base,
        source_item_id: parent,
        expected_revisions: { [parent]: 1 },
        child_attributes: [attr('contents', { remaining: { value: '1', unit: 'count' } })],
      }),
    ).rejects.toMatchObject({ code: 'STATE_CONFLICT' });
    const split = await write(ctx, 'split_item', {
      ...base,
      child_attributes: [attr('contents', { remaining: { value: '1', unit: 'count' } })],
    });
    for (const child of split.children)
      await write(ctx, 'void_item', {
        item_id: child.item_id,
        reason: 'duplicate',
        expected_revisions: { [child.item_id]: 1 },
      });
    await write(ctx, 'void_item', {
      item_id: source,
      reason: 'all split children void',
      expected_revisions: { [source]: 2 },
    });
    await expect(
      write(ctx, 'correct_item', {
        item_id: source,
        reason: 'restore',
        record_state: 'VALID',
        expected_revisions: { [source]: 3 },
      }),
    ).rejects.toMatchObject({ code: 'STATE_CONFLICT' });
  });
  it('MODEL14 preserves opaque future reference bindings on unrelated edits', async () => {
    const { ctx, sku } = await fixture(),
      i = await item(ctx, sku, [attr('custody', { owner: { future: 'unrecognized' } }, 99)]);
    await write(ctx, 'update_item', {
      item_id: i,
      display_name: 'preserved',
      expected_revisions: { [i]: 1 },
    });
    expect((await get(ctx, i)).attributes).toContainEqual({
      template_id: 'custody',
      template_version: 99,
      status: 'UNKNOWN',
      values: { owner: { future: 'unrecognized' } },
    });
  });
  it('MODEL05 semantic projections have runtime privileges without mutable split history', async () => {
    await transaction(async (c) => {
      await query(c, 'SET LOCAL ROLE acornary_app');
      const result = (
        await query(
          c,
          `SELECT has_table_privilege(current_user,'attribute_references','SELECT,INSERT,DELETE') AS refs,
        has_table_privilege(current_user,'item_splits','SELECT,INSERT') AS splits,
        has_table_privilege(current_user,'item_splits','DELETE') AS can_delete,
        has_table_privilege(current_user,'item_splits','UPDATE') AS can_update`,
        )
      ).rows[0];
      expect(result).toEqual({ refs: true, splits: true, can_delete: false, can_update: false });
    });
  });
  it('MODEL15 availability stays read-only and state facts vary independently of location', async () => {
    const { ctx, sku } = await fixture(),
      i = await item(ctx, sku, [attr('lifecycle', { availability: 'LOANED' })]);
    expect((await get(ctx, i)).derived_availability).toBeNull();
    expect(values(await get(ctx, i), 'custody')).toBeUndefined();
    await expect(
      update(ctx, i, 1, 'lifecycle', { availability: 'AVAILABLE' }),
    ).rejects.toMatchObject({ code: 'ATTRIBUTE_VALIDATION_FAILED' });
    await update(ctx, i, 1, 'usage', { state: 'IN_USE' });
    await update(ctx, i, 2, 'custody', {
      status: 'BORROWED_IN',
      holder: { kind: 'EXTERNAL', name: 'Friend' },
    });
    await update(ctx, i, 3, 'service', { state: 'CLEANING' });
    await update(ctx, i, 4, 'transport', { state: 'IN_TRANSIT' });
    const row = await get(ctx, i);
    expect(row.parent_id).toBeNull();
    expect(row.derived_availability).toBe('UNAVAILABLE');
    expect(values(row, 'lifecycle')).toEqual({ availability: 'LOANED' });
    expect(
      (
        await execute(ctx, 'query_items', {
          attribute_filters: [
            { template_id: 'service', path: 'state', op: 'eq', value: 'CLEANING' },
          ],
        })
      ).data,
    ).toHaveLength(1);
  });
});
