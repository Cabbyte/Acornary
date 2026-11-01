import { randomUUID } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { pool, query, transaction, type Client } from '../../apps/server/src/db.js';
import { createHousehold, initialize } from '../../apps/server/src/initialize.js';
import { execute, type Context } from '../../apps/server/src/service.js';
import { recordSyncChange } from '../../apps/server/src/sync.js';
import type { Operation } from '../../packages/contracts/src/index.js';
import { approvedExecute } from '../catalog-helpers.js';

type Change = {
  change_id: string;
  household_id: string;
  object_kind: 'ITEM' | 'CATALOG_NODE';
  object_id: string;
  revision: number;
  change_kind: string;
  operation_id: string;
  payload_version: number;
  after_image: unknown;
};

describe.skipIf(!process.env.DATABASE_URL)('Batch 1 sync writes (PostgreSQL)', () => {
  let ctx: Context, sku: string;
  const write = (name: Operation, input: Record<string, unknown>) =>
    approvedExecute(ctx, name, { idempotency_key: randomUUID(), ...input });
  const create = (count = 1, extra: Record<string, unknown> = {}) =>
    write('create_items', { catalog_node_id: sku, count, ...extra });
  const changes = async (operationId?: string) =>
    (
      await query<Change>(
        pool,
        `SELECT change_id::text,household_id,object_kind,object_id,revision,change_kind,
                operation_id,payload_version,after_image
         FROM sync_changes WHERE household_id=$1
         ${operationId ? 'AND operation_id=$2' : ''} ORDER BY change_id::bigint`,
        operationId ? [ctx.household_id, operationId] : [ctx.household_id],
      )
    ).rows;
  const state = async () =>
    (
      await query(
        pool,
        `SELECT sync_generation,last_committed_change_id::text,pruned_through_change_id::text
         FROM household_sync_state WHERE household_id=$1`,
        [ctx.household_id],
      )
    ).rows[0];
  const expectLogged = async (result: any) => {
    const rows = await changes(result.operation_id);
    expect(rows).toHaveLength(result.affected_objects.length);
    expect(rows.map((r) => r.object_id).sort()).toEqual(
      result.affected_objects.map((o: any) => o.id).sort(),
    );
    for (const object of result.affected_objects)
      expect(rows.find((r) => r.object_id === object.id)).toMatchObject({
        household_id: ctx.household_id,
        object_kind: object.kind,
        revision: object.after_revision,
        operation_id: result.operation_id,
        change_kind: 'UPSERT',
        payload_version: 1,
        after_image: null,
      });
    for (let i = 1; i < rows.length; i++)
      expect(BigInt(rows[i].change_id)).toBeGreaterThan(BigInt(rows[i - 1].change_id));
    if (rows.length) expect((await state()).last_committed_change_id).toBe(rows.at(-1)!.change_id);
    return rows;
  };

  beforeAll(async () => {
    const database = new URL(process.env.DATABASE_URL!).pathname.slice(1);
    if (!database.includes('acornary_test'))
      throw new Error('Sync DB tests require an isolated acornary_test database.');
    await initialize();
  }, 30000);
  beforeEach(async () => {
    const household = await transaction((c) => createHousehold(c, 'sync test'));
    ctx = { household_id: household.household_id, actor_id: household.actor_id, source: 'TEST' };
    sku = household.container_catalog_id;
  });
  afterAll(() => pool.end());

  it('logs one item creation and initializes state for a new household', async () => {
    expect(await state()).toBeUndefined();
    const result = await create();
    expect(await expectLogged(result)).toHaveLength(1);
    expect(await state()).toMatchObject({
      sync_generation: expect.any(String),
      pruned_through_change_id: '0',
    });
  });

  it('logs one item move and preserves the household generation', async () => {
    const parent = await create(1, {
      initial_attributes: [
        { template_id: 'container', template_version: 1, values: { can_contain: true } },
      ],
    });
    const item = (await create()).affected_objects[0].id;
    const before = await state();
    const result = await write('move_item', {
      item_id: item,
      parent_id: parent.affected_objects[0].id,
      expected_revisions: { [item]: 1 },
    });
    expect(await expectLogged(result)).toHaveLength(1);
    expect((await state()).sync_generation).toBe(before.sync_generation);
  });

  it('logs note creation, update and combined edit only on the owning item', async () => {
    const item = (await create()).affected_objects[0].id;
    const added = await write('add_note', {
      target: { kind: 'ITEM', id: item },
      body: 'First note',
      expected_revisions: { [item]: 1 },
    });
    expect(await expectLogged(added)).toHaveLength(1);
    const updated = await write('update_note', {
      note_id: added.note_id,
      body: 'Updated note',
      expected_revisions: { [item]: 2 },
    });
    expect(await expectLogged(updated)).toHaveLength(1);
    const edited = await write('edit_item', {
      item_id: item,
      display_name: 'Named item',
      note: { body: 'Combined edit' },
      expected_revisions: { [item]: 3 },
    });
    expect(await expectLogged(edited)).toHaveLength(1);
    expect((await changes()).every((r) => r.object_kind === 'ITEM' && r.object_id === item)).toBe(
      true,
    );
  });

  it('logs catalog creation and rename once each through real approval', async () => {
    const created = await write('create_catalog_node', { kind: 'SKU', name: 'Before rename' });
    expect(await expectLogged(created)).toHaveLength(1);
    const id = created.affected_objects[0].id;
    const renamed = await write('update_catalog_node', {
      catalog_node_id: id,
      name: 'After rename',
      expected_revisions: { [id]: 1 },
    });
    expect(await expectLogged(renamed)).toHaveLength(1);
    expect(await changes()).toHaveLength(2);
  });

  it('does not log a same-value item or note write or advance the watermark', async () => {
    const item = (await create(1, { display_name: 'Unchanged' })).affected_objects[0].id;
    const added = await write('add_note', {
      target: { kind: 'ITEM', id: item },
      body: 'Unchanged note',
      expected_revisions: { [item]: 1 },
    });
    const before = await state();
    for (const [name, input] of [
      ['update_item', { item_id: item, display_name: 'Unchanged' }],
      ['update_note', { note_id: added.note_id, body: 'Unchanged note' }],
    ] as const) {
      const result = await write(name, {
        expected_revisions: { [item]: 2 },
        ...input,
      });
      expect(result.changed).toBe(false);
      expect(await changes(result.operation_id)).toEqual([]);
    }
    expect(await changes()).toHaveLength(2);
    expect(await state()).toEqual(before);
  });

  it('replays the receipt without adding a change or advancing the watermark', async () => {
    const input = { catalog_node_id: sku, count: 1, idempotency_key: randomUUID() };
    const first = await execute(ctx, 'create_items', input);
    await expectLogged(first);
    const before = await state();
    expect(await execute(ctx, 'create_items', input)).toEqual(first);
    expect(await changes()).toHaveLength(1);
    expect(await state()).toEqual(before);
  });

  it.each([false, true])(
    'rolls back an earlier saved object (existing state: %s)',
    async (existing) => {
      if (existing) await create();
      const before = await state();
      const priorChanges = await changes();
      const idempotency_key = randomUUID();
      // The first entry reaches save(); the second fails inside the batch loop.
      await expect(
        execute(ctx, 'create_items_batch', {
          idempotency_key,
          items: [
            { client_ref: 'duplicate', catalog_node_id: sku },
            { client_ref: 'duplicate', catalog_node_id: sku },
          ],
        }),
      ).rejects.toMatchObject({ code: 'ATTRIBUTE_VALIDATION_FAILED', details: { item_index: 1 } });
      expect(await changes()).toEqual(priorChanges);
      expect(await state()).toEqual(before);
      for (const relation of ['items', 'events'])
        expect(
          (
            await query(pool, `SELECT id FROM ${relation} WHERE household_id=$1`, [
              ctx.household_id,
            ])
          ).rows,
        ).toHaveLength(existing ? 1 : 0);
      expect(
        (
          await query(
            pool,
            'SELECT 1 FROM operations WHERE household_id=$1 AND idempotency_key=$2',
            [ctx.household_id, idempotency_key],
          )
        ).rows,
      ).toEqual([]);
    },
  );

  it('logs one row per object in count-based and explicit batches with increasing IDs', async () => {
    const first = await create(2);
    const left = await expectLogged(first);
    expect(left).toHaveLength(2);
    const second = await write('create_items_batch', {
      items: ['a', 'b', 'c'].map((client_ref) => ({ client_ref, catalog_node_id: sku })),
    });
    const right = await expectLogged(second);
    expect(right).toHaveLength(3);
    expect(BigInt(right[0].change_id)).toBeGreaterThan(BigInt(left.at(-1)!.change_id));
    const ids = second.affected_objects.map((o: any) => o.id);
    const consumed = await write('consume_items', {
      item_ids: ids,
      expected_revisions: Object.fromEntries(ids.map((id: string) => [id, 1])),
    });
    expect(await expectLogged(consumed)).toHaveLength(3);
  });

  it('logs each item created by commit_intake under its outer operation', async () => {
    const context = await execute(ctx, 'get_intake_context', { catalog_node_ids: [sku] });
    const result = await write('commit_intake', {
      policy_revision: context.policy_revision,
      expected_revisions: context.expected_revisions,
      lines: [{ product: { catalog_node_id: sku }, instances: [{ count: 2 }] }],
    });
    expect(await expectLogged(result)).toHaveLength(2);
  });

  it('does not advance another household watermark when IDs interleave', async () => {
    await create();
    const before = await state();
    const other = await transaction((c) => createHousehold(c, 'other sync household'));
    const result = await execute({ ...other, source: 'TEST' }, 'create_items', {
      idempotency_key: randomUUID(),
      catalog_node_id: other.container_catalog_id,
      count: 1,
    });
    expect(await state()).toEqual(before);
    const otherChange = (
      await query<Change>(
        pool,
        'SELECT change_id::text FROM sync_changes WHERE household_id=$1 AND operation_id=$2',
        [other.household_id, result.operation_id],
      )
    ).rows[0];
    expect(BigInt(otherChange.change_id)).toBeGreaterThan(BigInt(before.last_committed_change_id));
    await expectLogged(await create());
  });

  // Exercise 011 itself against pre-existing households without changing the shared test schema.
  async function migrationFixture(check: (c: Client) => Promise<void>) {
    const c = await pool.connect();
    const schema = 'sync_' + randomUUID().replaceAll('-', '');
    try {
      await c.query('BEGIN');
      await c.query(`CREATE SCHEMA ${schema}`);
      await c.query(`SET LOCAL search_path TO ${schema},pg_catalog`);
      await c.query('CREATE TABLE households(id text PRIMARY KEY)');
      await c.query("INSERT INTO households VALUES('one'),('two')");
      await c.query(
        await readFile(new URL('../../migrations/011_sync_changes.sql', import.meta.url), 'utf8'),
      );
      await check(c);
    } finally {
      await c.query('ROLLBACK');
      c.release();
    }
  }

  it('backfills one zero-watermark state per existing household without inventing changes', async () => {
    await migrationFixture(async (c) => {
      const states = (await c.query('SELECT * FROM household_sync_state ORDER BY household_id'))
        .rows;
      expect(states).toHaveLength(2);
      expect(new Set(states.map((s) => s.sync_generation)).size).toBe(2);
      for (const s of states) {
        expect(s.last_committed_change_id).toBe('0');
        expect(s.pruned_through_change_id).toBe('0');
      }
      expect((await c.query('SELECT * FROM sync_changes')).rows).toEqual([]);
    });
  });

  it('preserves bigint precision and never lowers an existing household watermark', async () => {
    await migrationFixture(async (c) => {
      await c.query("SELECT setval('sync_changes_change_id_seq',9007199254740993,false)");
      await recordSyncChange(c, 'one', 'ITEM', 'item', 1, 'operation');
      expect(
        (
          await c.query(
            "SELECT last_committed_change_id::text AS id FROM household_sync_state WHERE household_id='one'",
          )
        ).rows[0].id,
      ).toBe('9007199254740993');
      await c.query(
        "UPDATE household_sync_state SET last_committed_change_id=9007199254740999 WHERE household_id='one'",
      );
      await recordSyncChange(c, 'one', 'ITEM', 'item', 2, 'next-operation');
      expect(
        (
          await c.query('SELECT change_id::text AS id FROM sync_changes ORDER BY change_id::bigint')
        ).rows.map((r) => r.id),
      ).toEqual(['9007199254740993', '9007199254740994']);
      expect(
        (
          await c.query(
            "SELECT last_committed_change_id::text AS id FROM household_sync_state WHERE household_id='one'",
          )
        ).rows[0].id,
      ).toBe('9007199254740999');
    });
  });
});
