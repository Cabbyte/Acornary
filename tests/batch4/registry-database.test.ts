import { readFileSync } from 'node:fs';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { randomUUID } from 'node:crypto';
import { execute, type Context } from '../../apps/server/src/service.js';
import { pool, query, transaction } from '../../apps/server/src/db.js';
import { publishTemplate, definitionHashes } from '../../apps/server/src/registry.js';
import { registry, templateDefinition, type Profile } from '../../packages/contracts/src/registry.js';
import { webSnapshot } from '../../apps/server/src/web.js';
import { approvedExecute } from '../catalog-helpers.js';
import type { Operation } from '../../packages/contracts/src/index.js';

const id = (kind: string) => `${kind}_${randomUUID()}`;
const binding = (template_id: string, values: any, template_version = 1) => ({
  template_id,
  template_version,
  values,
  created_at: '2020-02-03T04:05:06.123456+08:00',
  updated_at: '2021-03-04T05:06:07.654321Z',
});
async function fixture(attributes: any[] = [], catalogAttributes: any[] = []) {
  const ctx: Context = { household_id: id('household'), actor_id: id('actor'), source: 'TEST' };
  await query(
    pool,
    "INSERT INTO households(id,name,timezone) VALUES($1,'registry fixture','Asia/Shanghai')",
    [ctx.household_id],
  );
  await query(pool, "INSERT INTO actors(id,household_id,name) VALUES($1,$2,'registry fixture')", [
    ctx.actor_id,
    ctx.household_id,
  ]);
  const sku = id('catalog_node'),
    item = id('item');
  await query(
    pool,
    "INSERT INTO catalog_nodes(id,household_id,kind,name,attributes) VALUES($1,$2,'SKU','fixture',$3::jsonb)",
    [sku, ctx.household_id, JSON.stringify(catalogAttributes)],
  );
  await query(
    pool,
    'INSERT INTO items(id,household_id,catalog_node_id,attributes) VALUES($1,$2,$3,$4::jsonb)',
    [item, ctx.household_id, sku, JSON.stringify(attributes)],
  );
  return { ctx, sku, item };
}
const itemRead = (ctx: Context, item: string) => execute(ctx, 'get_item', { item_id: item });
const catalogRead = (ctx: Context, sku: string) =>
  execute(ctx, 'get_catalog_node', { catalog_node_id: sku });
async function write(ctx: Context, operation: Operation, input: any) {
  return approvedExecute(ctx, operation, { idempotency_key: randomUUID(), ...input });
}
async function raw(kind: 'items' | 'catalog_nodes', target: string) {
  return (
    await query(pool, `SELECT attributes::text AS attributes,revision FROM ${kind} WHERE id=$1`, [
      target,
    ])
  ).rows[0];
}
const enabled = !!process.env.DATABASE_URL;
describe.skipIf(!enabled)('Batch 4 migrated PostgreSQL registry', () => {
  beforeAll(async () => {
    if (!process.env.DATABASE_URL!.includes('acornary_test_w2_registry'))
      throw new Error('Use the isolated Batch 4 database.');
    await query(
      pool,
      'SELECT profile,capabilities,one_off,record_state FROM catalog_nodes LIMIT 0',
    );
  });
  afterAll(() => pool.end());

  it('MODEL01 preserves unknown IDs/versions, timestamps and array order through reads, rename, move, note and adding attributes', async () => {
    const originals = [
      binding('z_future', { empty: {}, list: [null, {}, '1.200'], nested: { x: null } }, 42),
      binding('a_future', { opaque: { precision: '0.000000000000000001' } }, 9),
    ];
    const { ctx, sku, item } = await fixture(originals, [
      binding('product', { future: [null, {}, 1] }, 42),
    ]);
    const baseline = await raw('items', item);
    const catalogBaseline = await raw('catalog_nodes', sku);
    const publicBinding = ({ created_at, updated_at, ...rest }: any) => rest;
    expect((await itemRead(ctx, item)).attributes).toEqual(
      originals.map((a) => ({ ...publicBinding(a), status: 'UNKNOWN' })),
    );
    expect((await catalogRead(ctx, sku)).attributes[0].status).toBe('UNKNOWN');
    expect(
      (await itemRead(ctx, item)).attributes.find((a: any) => a.template_id === 'z_future')?.values,
    ).toEqual(originals[0].values);
    const container = id('item');
    await query(
      pool,
      'INSERT INTO items(id,household_id,catalog_node_id,attributes) VALUES($1,$2,$3,$4::jsonb)',
      [
        container,
        ctx.household_id,
        sku,
        JSON.stringify([binding('container', { can_contain: true })]),
      ],
    );
    let revision = 1;
    for (const [operation, input] of [
      ['update_item', { item_id: item, display_name: 'renamed' }],
      ['move_item', { item_id: item, parent_id: container }],
      ['add_note', { target: { kind: 'ITEM', id: item }, body: 'preserve the opaque payload' }],
    ] as const) {
      await write(ctx, operation, {
        ...input,
        expected_revisions: { [item]: revision++ },
      });
      expect((await raw('items', item)).attributes).toBe(baseline.attributes);
    }
    await write(ctx, 'bind_attributes', {
      target: { kind: 'ITEM', id: item },
      template_id: 'lifecycle',
      template_version: 1,
      values: { state: 'ACTIVE' },
      expected_revisions: { [item]: revision },
    });
    const saved = JSON.parse((await raw('items', item)).attributes);
    expect(saved.slice(0, 2)).toEqual(originals);
    expect(saved.map((a: any) => a.template_id)).toEqual(['z_future', 'a_future', 'lifecycle']);
    const originalText = (
      await query(pool, 'SELECT ($1::jsonb)::text AS value', [JSON.stringify(originals)])
    ).rows[0].value;
    expect(
      (await query(pool, 'SELECT (attributes - 2)::text AS value FROM items WHERE id=$1', [item]))
        .rows[0].value,
    ).toBe(originalText);
    const events = (await query(pool, 'SELECT changes FROM events WHERE target_id=$1', [item]))
      .rows;
    expect(events).toHaveLength(4);
    expect(events.every((e) => e.changes.every((d: any) => !d.path.includes('future')))).toBe(true);
    await write(ctx, 'update_catalog_node', {
      catalog_node_id: sku,
      name: 'renamed sku',
      expected_revisions: { [sku]: 1 },
    });
    expect((await raw('catalog_nodes', sku)).attributes).toBe(catalogBaseline.attributes);
    const group = id('catalog_node');
    await query(
      pool,
      "INSERT INTO catalog_nodes(id,household_id,kind,name) VALUES($1,$2,'GROUP','group')",
      [group, ctx.household_id],
    );
    await write(ctx, 'move_catalog_node', {
      catalog_node_id: sku,
      parent_id: group,
      expected_revisions: { [sku]: 2 },
    });
    expect((await raw('catalog_nodes', sku)).attributes).toBe(catalogBaseline.attributes);
    const snapshot = await webSnapshot(ctx, {});
    expect(snapshot.items.find((i) => i.id === item)?.attributes.slice(0, 2)).toEqual(
      originals.map((a) => ({ ...publicBinding(a), status: 'UNKNOWN' })),
    );
    // Existing SQL browse reads also keep opaque values (their v2 projection is a separate lane).
    expect(
      (await execute(ctx, 'query_items', {})).data.find((i: any) => i.id === item).attributes[0]
        .values,
    ).toEqual(originals[0].values);
  });

  it('MODEL01 preserves PostgreSQL numeric precision in unchanged opaque JSONB', async () => {
    const { ctx, sku, item } = await fixture([binding('future_precision', { large: 0 })]);
    await query(
      pool,
      `UPDATE items SET attributes=jsonb_set(attributes,'{0,values}',
      '{"large":123456789012345678901234567890,"fraction":0.123456789012345678901234567890,"empty":{},"array":[null,{}]}'::jsonb) WHERE id=$1`,
      [item],
    );
    await write(ctx, 'update_catalog_node', {
      catalog_node_id: sku,
      profile: 'SPACE',
      expected_revisions: { [sku]: 1 },
    });
    const before = await raw('items', item);
    await write(ctx, 'update_item', {
      item_id: item,
      display_name: 'keep numeric bytes',
      expected_revisions: { [item]: 1 },
    });
    expect((await raw('items', item)).attributes).toBe(before.attributes);
    await write(ctx, 'bind_attributes', {
      target: { kind: 'ITEM', id: item },
      template_id: 'container',
      template_version: 1,
      values: { can_contain: false },
      expected_revisions: { [item]: 2 },
    });
    const preserved = (
      await query(pool, 'SELECT (attributes - 1)::text AS value FROM items WHERE id=$1', [item])
    ).rows[0].value;
    expect(preserved).toBe(before.attributes);
  });

  it('MODEL01 reads registered retired bindings verbatim and rejects every direct mutation, including no-op patches', async () => {
    const retired = binding('lifecycle', {
      state: 'ACTIVE',
      future: { empty: {}, array: [null, {}] },
    });
    const { ctx, sku, item } = await fixture([retired]);
    await query(
      pool,
      'INSERT INTO attribute_templates(household_id,id,version,target_kind,definition) VALUES($1,$2,1,$3,$4::jsonb)',
      [
        ctx.household_id,
        'lifecycle',
        'ITEM',
        JSON.stringify({ ...templateDefinition('lifecycle'), status: 'RETIRED' }),
      ],
    );
    const before = await raw('items', item);
    const { created_at, updated_at, ...retiredPublic } = retired;
    expect((await itemRead(ctx, item)).attributes).toEqual([
      { ...retiredPublic, status: 'RETIRED' },
    ]);
    await write(ctx, 'update_item', {
      item_id: item,
      display_name: 'retired remains readable',
      expected_revisions: { [item]: 1 },
    });
    await write(ctx, 'add_note', {
      target: { kind: 'ITEM', id: item },
      body: 'note',
      expected_revisions: { [item]: 2 },
    });
    expect((await raw('items', item)).attributes).toBe(before.attributes);
    for (const [operation, extra] of [
      ['update_attributes', { set: { state: 'ACTIVE' } }],
      ['remove_attributes', {}],
      ['bind_attributes', { values: { state: 'ACTIVE' } }],
    ] as const)
      await expect(
        write(ctx, operation, {
          target: { kind: 'ITEM', id: item },
          template_id: 'lifecycle',
          template_version: 1,
          expected_revisions: { [item]: 3 },
          ...extra,
        }),
      ).rejects.toMatchObject({ code: 'ATTRIBUTE_VALIDATION_FAILED' });
    expect(await raw('items', item)).toEqual({ ...before, revision: 3 });
    expect(
      (await execute(ctx, 'list_attribute_templates', {})).data.some(
        (t: any) => t.id === 'lifecycle' && t.version === 2,
      ),
    ).toBe(true);
    const parent = id('item');
    await query(
      pool,
      'INSERT INTO items(id,household_id,catalog_node_id,attributes) VALUES($1,$2,$3,$4::jsonb)',
      [
        parent,
        ctx.household_id,
        sku,
        JSON.stringify([binding('container', { can_contain: true })]),
      ],
    );
    await write(ctx, 'move_item', {
      item_id: item,
      parent_id: parent,
      expected_revisions: { [item]: 3 },
    });
    expect((await raw('items', item)).attributes).toBe(before.attributes);
    await write(ctx, 'update_catalog_node', {
      catalog_node_id: sku,
      profile: 'CONSUMABLE',
      expected_revisions: { [sku]: 1 },
    });
    await write(ctx, 'bind_attributes', {
      target: { kind: 'ITEM', id: item },
      template_id: 'contents',
      template_version: 1,
      values: { remaining: { value: '2', unit: 'g' } },
      expected_revisions: { [item]: 4 },
    });
    expect(
      (await query(pool, 'SELECT (attributes - 1)::text AS value FROM items WHERE id=$1', [item]))
        .rows[0].value,
    ).toBe(before.attributes);
  });

  it('MODEL01 rejects unknown template IDs and future versions with a stable validation error and no writes', async () => {
    const { ctx, item } = await fixture([binding('lifecycle', { state: 'ACTIVE' }, 99)]);
    const before = await raw('items', item);
    for (const template_id of ['future_template', 'lifecycle'])
      for (const operation of [
        'bind_attributes',
        'update_attributes',
        'remove_attributes',
      ] as const) {
        const extra =
          operation === 'bind_attributes'
            ? { values: { state: 'ACTIVE' } }
            : operation === 'update_attributes'
              ? { set: { state: 'ACTIVE' } }
              : {};
        await expect(
          write(ctx, operation, {
            target: { kind: 'ITEM', id: item },
            template_id,
            template_version: 99,
            expected_revisions: { [item]: 1 },
            ...extra,
          }),
        ).rejects.toMatchObject({ code: 'ATTRIBUTE_VALIDATION_FAILED' });
      }
    expect(await raw('items', item)).toEqual(before);
  });

  it('MODEL02 persists profile/capability/one_off changes, inherits on null, disables on [], and preserves facts', async () => {
    const { ctx, sku, item } = await fixture([], [binding('product', { brand: 'preserved' })]);
    const before = await raw('catalog_nodes', sku);
    let revision = 1;
    for (const [profile, capabilities, expected] of [
      ['DURABLE', null, ['asset', 'custody', 'service', 'deadline']],
      ['CONSUMABLE', [], []],
      ['WEARABLE', ['container'], ['container']],
      [null, null, []],
      ['SPACE', null, ['container']],
    ] as [Profile | null, string[] | null, string[]][]) {
      await write(ctx, 'update_catalog_node', {
        catalog_node_id: sku,
        profile,
        capabilities,
        one_off: true,
        expected_revisions: { [sku]: revision++ },
      });
      expect(await catalogRead(ctx, sku)).toMatchObject({
        profile,
        capabilities,
        one_off: true,
        effective_capabilities: expected,
        record_state: 'VALID',
      });
      expect((await itemRead(ctx, item)).effective_capabilities).toEqual(expected);
      expect((await raw('catalog_nodes', sku)).attributes).toBe(before.attributes);
    }
    const snap = await webSnapshot(ctx, {});
    expect(snap.catalog.find((r) => r.id === sku)).toMatchObject({
      effective_capabilities: ['container'],
      one_off: true,
      profile: 'SPACE',
      record_state: 'VALID',
    });
    expect(snap.items.find((r) => r.id === item)).toMatchObject({
      effective_capabilities: ['container'],
      record_state: 'VALID',
    });
    await expect(
      write(ctx, 'update_catalog_node', {
        catalog_node_id: sku,
        profile: 'DURABLE',
        expected_revisions: { [sku]: 1 },
      }),
    ).rejects.toMatchObject({ code: 'REVISION_CONFLICT' });
    await expect(
      execute(ctx, 'update_catalog_node', {
        catalog_node_id: sku,
        profile: 'DURABLE',
        idempotency_key: randomUUID(),
      }),
    ).rejects.toMatchObject({ code: 'MISSING_EXPECTED_REVISION' });
  });

  it('creates catalog fields with explicit revisions, emits events and replays the same operation', async () => {
    const { ctx } = await fixture();
    const input = {
      idempotency_key: randomUUID(),
      expected_revisions: {},
      kind: 'SKU',
      name: 'profiled',
      profile: 'CONSUMABLE',
      capabilities: null,
      one_off: true,
    };
    const result = await approvedExecute(ctx, 'create_catalog_node', input);
    expect(await approvedExecute(ctx, 'create_catalog_node', input)).toEqual(result);
    const sku = result.affected_objects[0].id;
    expect(await catalogRead(ctx, sku)).toMatchObject({
      profile: 'CONSUMABLE',
      capabilities: null,
      one_off: true,
      record_state: 'VALID',
      effective_capabilities: ['lifecycle.expiry', 'lifecycle.opening', 'contents', 'stock'],
    });
    const event = (
      await query(pool, 'SELECT changes FROM events WHERE id=$1', [result.event_ids[0]])
    ).rows[0];
    expect(event.changes.map((d: any) => d.path)).toEqual(
      expect.arrayContaining(['profile', 'capabilities', 'one_off']),
    );
    await expect(
      execute(ctx, 'create_catalog_node', {
        idempotency_key: randomUUID(),
        kind: 'SKU',
        name: 'missing revisions',
      }),
    ).rejects.toMatchObject({ code: 'APPROVAL_REQUIRED' });
  });

  it('filters templates by target/profile/capability/catalog overrides; unfiltered discovery returns all latest definitions', async () => {
    const { ctx, sku } = await fixture();
    const list = async (input: any = {}) =>
      (await execute(ctx, 'list_attribute_templates', input)).data;
    expect((await list()).map((t: any) => t.id).sort()).toEqual(
      [...new Set(registry.filter((t) => !t.retired).map((t) => t.id))].sort(),
    );
    expect((await list()).find((t: any) => t.id === 'product').version).toBe(2);
    expect((await list({ target_kind: 'ITEM' })).map((t: any) => t.id).sort()).toEqual(
      [...new Set(registry.filter((t) => !t.retired && t.target_kind === 'ITEM').map((t) => t.id))].sort(),
    );
    expect(
      (await list({ target_kind: 'ITEM', profile: 'CONSUMABLE' })).map((t: any) => t.id).sort(),
    ).toEqual(['contents', 'disposition', 'lifecycle']);
    expect((await list({ capability: 'lifecycle.expiry' })).map((t: any) => t.id)).toEqual([
      'lifecycle',
    ]);
    expect(await list({ profile: 'DURABLE', capability: 'lifecycle.expiry' })).toEqual([]);
    expect((await list({ capability: 'deadline' })).map((t: any) => t.id)).toEqual(['deadline']);
    const unknown = await list({ profile: null, target_kind: 'ITEM' });
    expect(unknown.map((t: any) => t.id).sort()).toEqual(['disposition', 'lifecycle']);
    const unknownLifecycle = unknown.find((t: any) => t.id === 'lifecycle')!;
    expect(unknownLifecycle.fields.map((f: any) => f.path)).not.toContain('expiry.date');
    expect(unknownLifecycle.paths).toContain('expiry.date');
    await write(ctx, 'update_catalog_node', {
      catalog_node_id: sku,
      profile: 'CONSUMABLE',
      capabilities: [],
      expected_revisions: { [sku]: 1 },
    });
    expect(
      (await list({ catalog_node_id: sku, target_kind: 'ITEM' })).map((t: any) => t.id),
    ).toEqual(['disposition', 'lifecycle']);
    await write(ctx, 'update_catalog_node', {
      catalog_node_id: sku,
      capabilities: ['container'],
      expected_revisions: { [sku]: 2 },
    });
    expect(
      (await list({ catalog_node_id: sku, target_kind: 'ITEM' })).map((t: any) => t.id).sort(),
    ).toEqual(['container', 'disposition', 'lifecycle']);
    const other = await fixture();
    await expect(list({ catalog_node_id: other.sku })).rejects.toMatchObject({ code: 'NOT_FOUND' });
  });

  it('uses the capability resolver for new configured bindings and keeps existing facts when capabilities are disabled', async () => {
    const { ctx, sku, item } = await fixture();
    await write(ctx, 'update_catalog_node', {
      catalog_node_id: sku,
      profile: 'CONSUMABLE',
      capabilities: [],
      expected_revisions: { [sku]: 1 },
    });
    const bind = {
      target: { kind: 'ITEM', id: item },
      template_id: 'contents',
      template_version: 1,
      values: { remaining: { value: '10', unit: 'g' } },
      expected_revisions: { [item]: 1 },
    };
    await expect(write(ctx, 'bind_attributes', bind)).rejects.toMatchObject({
      code: 'ATTRIBUTE_VALIDATION_FAILED',
    });
    await write(ctx, 'update_catalog_node', {
      catalog_node_id: sku,
      capabilities: null,
      expected_revisions: { [sku]: 2 },
    });
    await write(ctx, 'bind_attributes', bind);
    await write(ctx, 'update_catalog_node', {
      catalog_node_id: sku,
      capabilities: [],
      expected_revisions: { [sku]: 3 },
    });
    await write(ctx, 'update_attributes', {
      target: bind.target,
      template_id: 'contents',
      template_version: 1,
      set: { remaining: { value: '9', unit: 'g' } },
      expected_revisions: { [item]: 2 },
    });
    expect((await itemRead(ctx, item)).attributes[0].values.remaining.value).toBe('9');
  });

  it('MODEL13 appends the 16th binding, rejects the 17th atomically and leaves opaque bindings in position', async () => {
    const originals = Array.from({ length: 15 }, (_, i) =>
      binding(`future_${15 - i}`, { x: [null, {}] }, 100 + i),
    );
    const { ctx, item } = await fixture(originals);
    await write(ctx, 'bind_attributes', {
      target: { kind: 'ITEM', id: item },
      template_id: 'lifecycle',
      template_version: 1,
      values: { state: 'ACTIVE' },
      expected_revisions: { [item]: 1 },
    });
    const after16 = await raw('items', item);
    expect(JSON.parse(after16.attributes).slice(0, 15)).toEqual(originals);
    expect(JSON.parse(after16.attributes)).toHaveLength(16);
    await expect(
      write(ctx, 'bind_attributes', {
        target: { kind: 'ITEM', id: item },
        template_id: 'container',
        template_version: 1,
        values: { can_contain: true },
        expected_revisions: { [item]: 2 },
      }),
    ).rejects.toMatchObject({ code: 'ATTRIBUTE_VALIDATION_FAILED' });
    expect(await raw('items', item)).toEqual(after16);
    expect(
      (await query(pool, 'SELECT id FROM events WHERE target_id=$1', [item])).rows,
    ).toHaveLength(1);
  });

  it('MODEL13 publication is immutable, UI-only changes do not overwrite it, and absent known definitions seed on write', async () => {
    const { ctx, item } = await fixture();
    const definition = templateDefinition('product', 2);
    await transaction((c) => publishTemplate(c, ctx.household_id, definition));
    const stored = async () =>
      (
        await query(
          pool,
          'SELECT definition::text AS value FROM attribute_templates WHERE household_id=$1 AND id=$2 AND version=2',
          [ctx.household_id, 'product'],
        )
      ).rows[0].value;
    const original = await stored();
    expect(JSON.parse(original)).toMatchObject(definitionHashes(definition));
    const ui = structuredClone(definition);
    ui.fields[0].label = 'New label';
    await transaction((c) => publishTemplate(c, ctx.household_id, ui));
    expect(await stored()).toBe(original);
    const changed = structuredClone(definition);
    changed.schema = { type: 'object' };
    await expect(
      transaction((c) => publishTemplate(c, ctx.household_id, changed)),
    ).rejects.toMatchObject({ code: 'TEMPLATE_DEFINITION_CONFLICT' });
    expect(await stored()).toBe(original);
    await expect(
      query(pool, "UPDATE attribute_templates SET definition='{}' WHERE household_id=$1", [
        ctx.household_id,
      ]),
    ).rejects.toThrow();
    await write(ctx, 'bind_attributes', {
      target: { kind: 'ITEM', id: item },
      template_id: 'lifecycle',
      template_version: 1,
      values: { state: 'ACTIVE' },
      expected_revisions: { [item]: 1 },
    });
    expect(
      (
        await query(
          pool,
          'SELECT definition FROM attribute_templates WHERE household_id=$1 AND id=$2',
          [ctx.household_id, 'lifecycle'],
        )
      ).rows[0].definition.schema_hash,
    ).toMatch(/^[a-f0-9]{64}$/);
  });

  it('MODEL13 accepts the legacy migration publication without rewriting its definition or timestamp', async () => {
    const { ctx } = await fixture();
    const sql = readFileSync('migrations/007_product_v2.sql', 'utf8');
    const legacy = JSON.parse(sql.slice(sql.indexOf('{"id"'), sql.lastIndexOf('}') + 1));
    await query(
      pool,
      `INSERT INTO attribute_templates(household_id,id,version,target_kind,definition)
      VALUES($1,'product',2,'CATALOG_NODE',$2::jsonb)`,
      [ctx.household_id, JSON.stringify(legacy)],
    );
    const read = async () =>
      (
        await query(
          pool,
          `SELECT definition::text,created_at::text FROM attribute_templates
      WHERE household_id=$1 AND id='product' AND version=2`,
          [ctx.household_id],
        )
      ).rows[0];
    const before = await read();
    await transaction((c) =>
      publishTemplate(c, ctx.household_id, templateDefinition('product', 2)),
    );
    expect(await read()).toEqual(before);
  });

  it('uses registered upgrade edges with exact source revision/version, full target values and preserved binding creation time', async () => {
    const original = binding('product', { brand: 'original', specification: 'old' });
    const { ctx, sku } = await fixture([], [original]);
    const base = {
      target: { kind: 'CATALOG_NODE', id: sku },
      template_id: 'product',
      from_version: 1,
      to_version: 2,
      values: { brand: 'original', shelf_life_days: 90 },
      expected_revisions: { [sku]: 1 },
    };
    await expect(
      write(ctx, 'upgrade_attributes', { ...base, from_version: 2 }),
    ).rejects.toMatchObject({ code: 'ATTRIBUTE_VALIDATION_FAILED' });
    await expect(
      write(ctx, 'upgrade_attributes', { ...base, to_version: 3 }),
    ).rejects.toMatchObject({ code: 'ATTRIBUTE_VALIDATION_FAILED' });
    await write(ctx, 'upgrade_attributes', base);
    const row = await catalogRead(ctx, sku);
    expect(row.attributes[0]).toMatchObject({
      template_version: 2,
      values: base.values,
    });
    expect(row.attributes[0].values.specification).toBeUndefined();
    expect(row.revision).toBe(2);
    await expect(write(ctx, 'upgrade_attributes', base)).rejects.toMatchObject({
      code: 'REVISION_CONFLICT',
    });
    const legacy = await fixture([], [original]);
    await write(legacy.ctx, 'upgrade_attributes', {
      target: { kind: 'CATALOG_NODE', id: legacy.sku },
      template_id: 'product',
      template_version: 2,
      values: { brand: 'legacy' },
      expected_revisions: { [legacy.sku]: 1 },
    });
    expect((await catalogRead(legacy.ctx, legacy.sku)).attributes[0].template_version).toBe(2);
  });

  it('advertises exactly the implemented features and keeps database column constraints', async () => {
    const { ctx, sku, item } = await fixture();
    expect(await execute(ctx, 'get_connection_context', {})).toMatchObject({
      protocol: { current: 2, min: 2 },
      features: ['frozen_export', 'query_v2', 'history_v2', 'snapshot_v2', 'groups_v2', 'sync_v2', 'profile_capabilities', 'deadline', 'notes_v2', 'attachments', 'stock', 'void', 'split', 'references', 'units_v2', 'protocol_v2'],
    });
    for (const assignment of ["profile='OTHER'", "record_state='INVALID'", 'one_off=NULL'])
      await expect(
        query(pool, `UPDATE catalog_nodes SET ${assignment} WHERE id=$1`, [sku]),
      ).rejects.toThrow();
    await expect(
      query(pool, "UPDATE items SET record_state='INVALID' WHERE id=$1", [item]),
    ).rejects.toThrow();
    expect(await catalogRead(ctx, sku)).toMatchObject({
      profile: null,
      capabilities: null,
      one_off: false,
      record_state: 'VALID',
    });
    expect(await itemRead(ctx, item)).toMatchObject({
      record_state: 'VALID',
      effective_capabilities: [],
    });
  });
});
