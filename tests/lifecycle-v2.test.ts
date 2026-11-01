import { afterAll, describe, expect, it } from 'vitest';
import { randomUUID } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import pg from 'pg';
import { schemas, type Operation } from '../packages/contracts/src/index.js';
import {
  canUpgrade,
  latestTemplateVersion,
  templateDefinition,
  templates,
  validateValues,
} from '../packages/contracts/src/registry.js';
import { derivedAvailability } from '../packages/contracts/src/semantics.js';
import { execute, load, type Context } from '../apps/server/src/service.js';
import { runMigrations } from '../apps/server/src/migrate.js';
import { pool, type Client } from '../apps/server/src/db.js';
import { readItemsV2 } from '../apps/server/src/web.js';
import { itemDatesJsonSql } from '../apps/server/src/dates.js';
async function snapshot(c: pg.Client) {
  const tables = (
    await c.query("SELECT tablename FROM pg_tables WHERE schemaname='public' ORDER BY tablename")
  ).rows;
  const result: Record<string, any[]> = {};
  for (const { tablename } of tables) {
    const quoted = '"' + tablename.replaceAll('"', '""') + '"';
    result[tablename] = (
      await c.query(`SELECT to_jsonb(t) AS row FROM ${quoted} t ORDER BY to_jsonb(t)::text`)
    ).rows.map((r) => r.row);
  }
  return result;
}

const id = (kind: string) => `${kind}_${randomUUID()}`;
const binding = (template_id: string, values: any, template_version = 1) => ({
  template_id,
  template_version,
  values,
  created_at: '2026-01-02T03:04:05.123456+00:00',
  updated_at: '2026-02-03T04:05:06.654321+00:00',
});
const write = (ctx: Context, operation: Operation, input: any) =>
  execute(ctx, operation, { idempotency_key: randomUUID(), ...input });
async function fixture(c: pg.Client | pg.Pool | Client) {
  const ctx: Context = { household_id: id('household'), actor_id: id('actor'), source: 'TEST' };
  const sku = id('catalog_node');
  await c.query(
    "INSERT INTO households(id,name,timezone) VALUES($1,'lifecycle v2','Asia/Shanghai')",
    [ctx.household_id],
  );
  await c.query("INSERT INTO actors(id,household_id,name) VALUES($1,$2,'tester')", [
    ctx.actor_id,
    ctx.household_id,
  ]);
  await c.query(
    "INSERT INTO catalog_nodes(id,household_id,kind,name) VALUES($1,$2,'SKU','fixture')",
    [sku, ctx.household_id],
  );
  return { ctx, sku };
}
async function item(c: pg.Client | pg.Pool | Client, ctx: Context, sku: string, attributes: any[]) {
  const itemId = id('item');
  await c.query(
    'INSERT INTO items(id,household_id,catalog_node_id,attributes) VALUES($1,$2,$3,$4::jsonb)',
    [itemId, ctx.household_id, sku, JSON.stringify(attributes)],
  );
  return itemId;
}

describe('lifecycle v2 contracts', () => {
  it('publishes v2 without availability while preserving the historical v1 schema', () => {
    expect(latestTemplateVersion('lifecycle')).toBe(2);
    expect(canUpgrade('lifecycle', 1, 2)).toBe(true);
    expect(canUpgrade('lifecycle', 2, 1)).toBe(false);
    expect(validateValues('lifecycle', { availability: 'LOANED' }, 1)).toEqual({
      availability: 'LOANED',
    });
    expect(() => validateValues('lifecycle', { availability: 'LOANED' }, 2)).toThrow();
    expect(templates.lifecycle.schema.safeParse({ availability: 'AVAILABLE' }).success).toBe(false);
    const definition = templateDefinition('lifecycle', 2);
    expect(definition.paths).not.toContain('availability');
    expect(definition.fields.map((f) => f.path)).not.toContain('availability');
    expect((definition.schema as any).properties).not.toHaveProperty('availability');
    expect(schemas.edit_item.shape).not.toHaveProperty('availability');
    expect(templateDefinition('lifecycle', 1).paths).toContain('availability');
  });
});

describe.skipIf(!process.env.DATABASE_URL)('lifecycle v2 PostgreSQL', () => {
  afterAll(() => pool.end());

  it('maps every legacy value, preserves structured bindings and all other tables, and reruns safely', async () => {
    const url = new URL(process.env.DATABASE_URL!);
    if (!url.pathname.includes('acornary_test')) throw new Error('Requires isolated test database');
    const admin = new pg.Client({ connectionString: url.toString() });
    await admin.connect();
    const database = `acornary_test_lifecycle_${randomUUID().replaceAll('-', '')}`;
    let c: pg.Client | undefined;
    try {
      await admin.query(`CREATE DATABASE ${database}`);
      url.pathname = `/${database}`;
      c = new pg.Client({ connectionString: url.toString() });
      await c.connect();
      await runMigrations(c as Client);
      const { ctx, sku } = await fixture(c);
      const migration = await readFile('migrations/024_lifecycle_v2.sql', 'utf8');
      const cases: [unknown, string | null, any][] = [
        ['IN_USE', 'usage', { state: 'IN_USE' }],
        ['LOANED', 'custody', { status: 'LOANED_OUT' }],
        ['CLEANING', 'service', { state: 'CLEANING' }],
        ['MAINTENANCE', 'service', { state: 'MAINTENANCE' }],
        ['IN_TRANSIT', 'transport', { state: 'IN_TRANSIT' }],
        ['AVAILABLE', null, null],
        [null, null, null],
        [undefined, null, null],
      ];
      const expectations = new Map<string, any[]>();
      for (const [availability, replacement, values] of cases) {
        for (const existing of replacement ? [false, true] : [false]) {
          const life = binding('lifecycle', {
            ...(availability === undefined ? {} : { availability }),
            condition: 'GOOD',
            expiry: { date: '2027-01-01' },
          });
          // Even an existing empty future binding must take precedence.
          const prior = existing ? [binding(replacement!, {}, 99)] : [];
          const attrs = [...prior, life, binding('asset', { serial_no: 'untouched' })];
          const itemId = await item(c, ctx, sku, attrs);
          const { availability: _, ...kept } = life.values;
          expectations.set(itemId, [
            ...prior,
            { ...life, template_version: 2, values: kept },
            attrs.at(-1),
            ...(!existing && replacement ? [binding(replacement, values)] : []),
          ]);
        }
      }
      const emptyId = await item(c, ctx, sku, [
        binding('lifecycle', { availability: 'AVAILABLE' }),
      ]);
      expectations.set(emptyId, [binding('lifecycle', {}, 2)]);
      await item(c, ctx, sku, [binding('lifecycle', { condition: 'NEW' }, 2)]);
      const operationId = id('operation');
      await c.query(
        'INSERT INTO operations(household_id,actor_id,idempotency_key,fingerprint,result) VALUES($1,$2,$3,$4,$5)',
        [
          ctx.household_id,
          ctx.actor_id,
          randomUUID(),
          'historical-fingerprint',
          { operation_id: operationId },
        ],
      );
      await c.query(
        `INSERT INTO events(id,household_id,target_kind,target_id,operation_id,event_type,before_revision,after_revision,changes,actor_id,source,occurred_at)
        VALUES($1,$2,'ITEM',$3,$4,'ATTRIBUTE_UPDATE',1,2,$5,$6,'TEST',now())`,
        [
          id('event'),
          ctx.household_id,
          emptyId,
          operationId,
          JSON.stringify([
            {
              path: 'attributes.lifecycle.availability',
              before: 'IN_USE',
              after: 'AVAILABLE',
              template_version: 1,
            },
          ]),
          ctx.actor_id,
        ],
      );
      await c.query(
        'INSERT INTO attribute_templates(household_id,id,version,target_kind,definition) VALUES($1,$2,1,$3,$4)',
        [ctx.household_id, 'lifecycle', 'ITEM', templateDefinition('lifecycle', 1)],
      );
      const before = await snapshot(c);
      await c.query('BEGIN');
      await c.query(migration);
      await c.query('COMMIT');
      const after = await snapshot(c);
      for (const [table, rows] of Object.entries(before)) {
        if (table !== 'items') expect(after[table], table).toEqual(rows);
      }
      for (const original of before.items) {
        const actual = after.items.find((row) => row.id === original.id);
        expect(actual).toEqual({
          ...original,
          attributes: expectations.get(original.id) ?? original.attributes,
        });
        expect(new Set(actual.attributes.map((a: any) => a.template_id)).size).toBe(
          actual.attributes.length,
        );
      }
      expect(after.date_facts).toEqual([]);
      // Registry fallback: no lifecycle v2 row was seeded by the migration.
      expect(
        after.attribute_templates.some((row) => row.id === 'lifecycle' && row.version === 2),
      ).toBe(false);
      for (const itemId of expectations.keys()) {
        const obj = await load(c as Client, ctx, { kind: 'ITEM', id: itemId });
        expect(obj.versions?.lifecycle).toBe(2);
        expect(obj.sets.lifecycle).not.toHaveProperty('availability');
      }
      expect(
        (await readItemsV2(c as Client, ctx.household_id)).every(
          (row) => row.attributes.find((a) => a.template_id === 'lifecycle')?.status === 'KNOWN',
        ),
      ).toBe(true);
      const datedId = expectations.keys().next().value!;
      const dates = (
        await c.query(
          `SELECT ${itemDatesJsonSql()} AS dates FROM items o JOIN households h ON h.id=o.household_id WHERE o.id=$1`,
          [datedId],
        )
      ).rows[0].dates;
      expect(dates).toEqual([expect.objectContaining({ due_on: '2027-01-01', source_version: 2 })]);
      await c.query('BEGIN');
      await c.query(migration);
      await c.query('COMMIT');
      expect(await snapshot(c)).toEqual(after);

      for (const bad of [
        [binding('lifecycle', { availability: 'FUTURE_VALUE' })],
        [
          binding('lifecycle', { availability: 'IN_USE' }),
          binding('usage', {}),
          binding('usage', {}),
        ],
        [
          binding('lifecycle', { availability: 'IN_USE' }),
          ...Array.from({ length: 15 }, (_, i) => binding(`future_${i}`, {})),
        ],
      ]) {
        const badId = await item(c, ctx, sku, bad);
        await c.query('BEGIN');
        await expect(c.query(migration)).rejects.toThrow(/lifecycle v2:/);
        await c.query('ROLLBACK');
        expect(
          (await c.query('SELECT attributes FROM items WHERE id=$1', [badId])).rows[0].attributes,
        ).toEqual(bad);
        await c.query('DELETE FROM items WHERE id=$1', [badId]);
      }
    } finally {
      await c?.end();
      await admin.query(`DROP DATABASE IF EXISTS ${database} WITH (FORCE)`);
      await admin.end();
    }
  });

  it('reads v1 history, accepts only explicit target values, and writes v2 without guessing semantics', async () => {
    const { ctx, sku } = await fixture(pool);
    const legacy = binding('lifecycle', {
      availability: 'LOANED',
      condition: 'GOOD',
      expiry: { date: '2027-01-01' },
    });
    const itemId = await item(pool, ctx, sku, [legacy]);
    expect((await execute(ctx, 'get_item', { item_id: itemId })).attributes[0]).toMatchObject({
      template_id: 'lifecycle',
      template_version: 1,
      values: legacy.values,
    });
    const input = {
      target: { kind: 'ITEM', id: itemId },
      template_id: 'lifecycle',
      from_version: 1,
      to_version: 2,
      expected_revisions: { [itemId]: 1 },
    };
    await expect(write(ctx, 'upgrade_attributes', input)).rejects.toMatchObject({
      code: 'ATTRIBUTE_VALIDATION_FAILED',
    });
    await expect(
      write(ctx, 'upgrade_attributes', { ...input, values: legacy.values }),
    ).rejects.toMatchObject({ code: 'ATTRIBUTE_VALIDATION_FAILED' });
    const values = { condition: 'WORN', expiry: { date: '2027-02-01' } };
    const upgraded = await write(ctx, 'upgrade_attributes', { ...input, values });
    const row = await execute(ctx, 'get_item', { item_id: itemId });
    expect(row.attributes).toEqual([
      expect.objectContaining({ template_id: 'lifecycle', template_version: 2, values }),
    ]);
    expect(row.derived_availability).toBeNull();
    const history = await execute(ctx, 'get_history', { operation_id: upgraded.operation_id });
    expect(history.data[0].changes).toContainEqual(
      expect.objectContaining({ path: 'attributes.lifecycle.availability', before: 'LOANED' }),
    );
    await expect(
      write(ctx, 'edit_item', {
        item_id: itemId,
        availability: 'AVAILABLE',
        expected_revisions: { [itemId]: 2 },
      }),
    ).rejects.toMatchObject({ code: 'ATTRIBUTE_VALIDATION_FAILED' });
    await expect(
      write(ctx, 'update_attributes', {
        target: input.target,
        template_id: 'lifecycle',
        template_version: 2,
        set: { availability: 'AVAILABLE' },
        expected_revisions: { [itemId]: 2 },
      }),
    ).rejects.toMatchObject({ code: 'ATTRIBUTE_VALIDATION_FAILED' });
    await expect(
      execute(ctx, 'query_items', {
        attribute_filters: [
          { template_id: 'lifecycle', path: 'availability', op: 'eq', value: 'AVAILABLE' },
        ],
      }),
    ).rejects.toMatchObject({ code: 'ATTRIBUTE_VALIDATION_FAILED' });
    await write(ctx, 'edit_item', {
      item_id: itemId,
      acquired_on: '2026-10-01',
      expected_revisions: { [itemId]: 2 },
    });
    await write(ctx, 'bind_attributes', {
      target: input.target,
      template_id: 'usage',
      template_version: 1,
      values: { state: 'IN_USE' },
      expected_revisions: { [itemId]: 3 },
    });
    const result = await execute(ctx, 'query_items', {});
    expect(result.data[0].derived_availability).toBe('UNAVAILABLE');
    expect(result.summary).not.toHaveProperty('unknown_availability_count');
    const empty = await item(pool, ctx, sku, [binding('lifecycle', { availability: 'AVAILABLE' })]);
    await write(ctx, 'upgrade_attributes', {
      ...input,
      target: { kind: 'ITEM', id: empty },
      expected_revisions: { [empty]: 1 },
      values: {},
    });
    expect((await execute(ctx, 'get_item', { item_id: empty })).attributes).toEqual([
      expect.objectContaining({ template_version: 2, values: {} }),
    ]);
    // Commands without an existing binding create v2; historical client payloads
    // still cannot reintroduce availability through v1.
    const fresh = await item(pool, ctx, sku, []);
    await write(ctx, 'open_item', { item_id: fresh, expected_revisions: { [fresh]: 1 } });
    expect((await execute(ctx, 'get_item', { item_id: fresh })).attributes[0]).toMatchObject({
      template_id: 'lifecycle',
      template_version: 2,
    });
    for (const version of [1, 2])
      await expect(
        write(ctx, 'create_items', {
          catalog_node_id: sku,
          count: 1,
          initial_attributes: [
            {
              template_id: 'lifecycle',
              template_version: version,
              values: { availability: 'AVAILABLE' },
            },
          ],
        }),
      ).rejects.toMatchObject({ code: 'ATTRIBUTE_VALIDATION_FAILED' });
    expect(derivedAvailability({ lifecycle: { availability: 'AVAILABLE' } })).toBeNull();
  });
});
