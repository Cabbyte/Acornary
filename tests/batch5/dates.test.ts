import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { randomUUID } from 'node:crypto';
import { execute, type Context } from '../../apps/server/src/service.js';
import { createHousehold } from '../../apps/server/src/initialize.js';
import { pool, query, transaction } from '../../apps/server/src/db.js';
import { rebuildDateFacts } from '../../apps/server/src/dates.js';
import {
  parseCommand,
  validateValues,
  type Operation,
} from '../../packages/contracts/src/index.js';

const enabled = Boolean(process.env.DATABASE_URL);
let ctx: Context;
let sku: string;
const get = (item_id: string) => execute(ctx, 'get_item', { item_id });
const values = (item: any, template: string) =>
  item.attributes.find((a: any) => a.template_id === template)?.values;
async function write(name: Operation, item_id: string, data: any = {}) {
  const item = await get(item_id);
  const input = {
    item_id,
    expected_revisions: { [item_id]: item.revision },
    idempotency_key: randomUUID(),
    ...data,
  };
  return execute(
    ctx,
    name,
    Object.fromEntries(Object.entries(input).filter(([, value]) => value !== undefined)),
  );
}
async function item(lifecycle?: any) {
  const result = await execute(ctx, 'create_items', {
    catalog_node_id: sku,
    count: 1,
    idempotency_key: randomUUID(),
    ...(lifecycle
      ? {
          initial_attributes: [
            { template_id: 'lifecycle', template_version: 1, values: lifecycle },
          ],
        }
      : {}),
  });
  return result.affected_objects[0].id as string;
}
async function add(item_id: string, entry: any) {
  await write('add_deadline', item_id, { entry });
  return values(await get(item_id), 'deadline').entries.at(-1).id as string;
}
async function facts(item_id: string) {
  return (
    await query(
      pool,
      'SELECT to_jsonb(d) AS row FROM date_facts d WHERE household_id=$1 AND item_id=$2 ORDER BY source_key,entry_id',
      [ctx.household_id, item_id],
    )
  ).rows.map((r) => r.row);
}
async function scoped(item_id: string, filters: any[], extra: any = {}) {
  return execute(ctx, 'query_items', { search: item_id, date_filters: filters, ...extra });
}

describe.skipIf(!enabled)('Batch 5 dates on migrated PostgreSQL', () => {
  beforeAll(async () => {
    if (!process.env.DATABASE_URL!.includes('acornary_test'))
      throw new Error('Use an isolated acornary_test database.');
    ctx = {
      ...(await transaction((c) => createHousehold(c, 'Batch 5', 'America/New_York'))),
      source: 'TEST',
    };
    sku = 'catalog_node_' + randomUUID();
    await query(
      pool,
      "INSERT INTO catalog_nodes(id,household_id,kind,name) VALUES($1,$2,'SKU','Batch 5 item')",
      [sku, ctx.household_id],
    );
  });
  afterAll(async () => {
    await pool.end();
  });

  it('MODEL03 keeps stable IDs, only deadline date sources, and atomically completes recurring service', async () => {
    const item_id = await item();
    const entry_id = await add(item_id, {
      kind: 'SERVICE_DUE',
      due_on: '2026-01-01',
      recurrence_days: 2,
      note: 'filter',
    });
    expect(entry_id).toMatch(/^deadline_[0-9a-f-]{36}$/);
    const before = await get(item_id);
    const input = {
      item_id,
      entry_id,
      completed_on: '2026-03-07',
      expected_revisions: { [item_id]: before.revision },
      idempotency_key: randomUUID(),
    };
    const result = await execute(ctx, 'complete_deadline', input);
    expect(result.event_ids).toHaveLength(1);
    expect(result.affected_objects).toEqual([
      {
        kind: 'ITEM',
        id: item_id,
        before_revision: before.revision,
        after_revision: before.revision + 1,
      },
    ]);
    const after = await get(item_id);
    expect(values(after, 'deadline').entries).toEqual([
      {
        id: entry_id,
        kind: 'SERVICE_DUE',
        due_on: '2026-03-09',
        recurrence_days: 2,
        last_completed_on: '2026-03-07',
        note: 'filter',
      },
    ]);
    expect(values(after, 'service')).toEqual({ last_service_on: '2026-03-07' });
    expect(after).toMatchObject({
      id: item_id,
      reminder_date: '2026-03-09',
      dates: [{ key: `deadline.${entry_id}`, source: 'DEADLINE', completed_on: null }],
    });
    expect(after).not.toHaveProperty('item');
    const projected = await facts(item_id);
    expect(projected).toHaveLength(1);
    expect(projected[0]).toMatchObject({
      source_key: 'deadline',
      entry_id,
      source_template: 'deadline',
      source_version: 1,
      due_on: '2026-03-09',
      completed_on: null,
    });
    const changes = (
      await query(
        pool,
        'SELECT change_id::text FROM sync_changes WHERE household_id=$1 AND object_id=$2 ORDER BY change_id DESC LIMIT 1',
        [ctx.household_id, item_id],
      )
    ).rows;
    expect(String(projected[0].projected_through_change_id)).toBe(changes[0].change_id);
    const history = await execute(ctx, 'get_history', { operation_id: result.operation_id });
    expect(history.data).toHaveLength(1);
    expect(history.data[0].event_type).toBe('COMPLETE_DEADLINE');
    expect(history.data[0].changes.map((c: any) => c.path)).toEqual(
      expect.arrayContaining(['attributes.deadline.entries', 'attributes.service.last_service_on']),
    );
    expect(await execute(ctx, 'complete_deadline', input)).toEqual(result);
    expect(await facts(item_id)).toEqual(projected);
    await expect(
      execute(ctx, 'complete_deadline', { ...input, idempotency_key: randomUUID() }),
    ).rejects.toMatchObject({ code: 'REVISION_CONFLICT' });
  });

  it('completes one-off dates, excludes them from reminders, and retains history after removal', async () => {
    const item_id = await item();
    const entry_id = await add(item_id, { kind: 'RETURN_BY', due_on: '2026-06-01', basis: 'loan' });
    await write('complete_deadline', item_id, { entry_id, completed_on: '2026-05-30' });
    const completed = await get(item_id);
    expect(completed).toMatchObject({
      reminder_date: null,
      reminder: { basis: [] },
      dates: [{ state: 'COMPLETED', completed_on: '2026-05-30', label: '应还' }],
    });
    expect(
      (await scoped(item_id, [{ state: 'COMPLETED', kind: 'RETURN_BY' }])).matching_count,
    ).toBe(1);
    expect((await scoped(item_id, [{ state: 'UPCOMING' }])).matching_count).toBe(0);
    expect(
      (await write('complete_deadline', item_id, { entry_id, completed_on: '2026-05-30' })).changed,
    ).toBe(false);
    await expect(
      write('complete_deadline', item_id, { entry_id, completed_on: '2026-06-01' }),
    ).rejects.toMatchObject({ code: 'INVALID_TRANSITION' });
    await write('remove_deadline', item_id, { entry_id });
    expect((await get(item_id)).dates).toEqual([]);
    expect(await facts(item_id)).toEqual([]);
    const history = await execute(ctx, 'get_history', {
      target: { kind: 'ITEM', id: item_id },
      event_type: 'COMPLETE_DEADLINE',
    });
    expect(history.data).toHaveLength(1);
  });

  it('QUERY07 applies kind, source, bounds and state to one row and ANDs separate filters', async () => {
    const item_id = await item({ expiry: { date: '2026-06-01', date_kind: 'USE_BY' } });
    const service = await add(item_id, { kind: 'SERVICE_DUE', due_on: '2026-12-01' });
    const warranty = await add(item_id, { kind: 'WARRANTY_END', due_on: '2026-06-01' });
    await write('complete_deadline', item_id, { entry_id: warranty, completed_on: '2026-06-02' });
    expect(
      (await scoped(item_id, [{ kind: 'SERVICE_DUE', from: '2026-06-01', to: '2026-06-01' }]))
        .matching_count,
    ).toBe(0);
    expect(
      (await scoped(item_id, [{ kind: 'SERVICE_DUE', state: 'COMPLETED' }])).matching_count,
    ).toBe(0);
    expect((await scoped(item_id, [{ kind: 'EXPIRY', source: 'DEADLINE' }])).matching_count).toBe(
      0,
    );
    expect(
      (
        await scoped(item_id, [
          { kind: 'EXPIRY', from: '2026-06-01', to: '2026-06-01' },
          { kind: 'WARRANTY_END', state: 'COMPLETED' },
        ])
      ).matching_count,
    ).toBe(1);
    expect(
      (await scoped(item_id, [{ kind: 'EXPIRY' }, { kind: 'RETURN_BY' }])).matching_count,
    ).toBe(0);
    await write('update_deadline', item_id, {
      entry_id: service,
      patch: { due_on: '2026-06-01', recurrence_days: 30 },
    });
    expect(
      (await scoped(item_id, [{ kind: 'SERVICE_DUE', from: '2026-06-01', to: '2026-06-01' }]))
        .matching_count,
    ).toBe(1);
    const first = await scoped(item_id, [{ kind: 'EXPIRY' }]);
    expect(first.summary.matching_count).toBe(1);
  });

  it('preserves lifecycle dates and unifies reminder sorting with deadlines, including null keysets', async () => {
    const food = await item({
      expiry: { date: '2026-06-10', date_kind: 'BEST_BEFORE', after_opening_days: 2 },
      opening: { opened_at: '2026-03-08T04:30:00Z' },
    });
    const durable = await item();
    const unknown = await item();
    await add(durable, { kind: 'RENEWAL', due_on: '2026-02-01' });
    const detail = await get(food);
    expect(detail.dates).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          key: 'lifecycle.expiry',
          date_kind: 'BEST_BEFORE',
          due_on: '2026-06-10',
        }),
        expect.objectContaining({
          key: 'lifecycle.opening',
          source: 'LIFECYCLE',
          due_on: '2026-03-09',
        }),
      ]),
    );
    expect(detail.reminder).toEqual({
      date: '2026-03-09',
      basis: [
        'lifecycle.expiry.date',
        'lifecycle.opening.opened_at + lifecycle.expiry.after_opening_days',
      ],
    });
    expect(values(detail, 'deadline')).toBeUndefined();
    expect(await get(unknown)).toMatchObject({
      dates: [],
      reminder_date: null,
      reminder: { basis: [] },
    });
    // A dedicated container scopes the three records without unrelated fixture dates.
    const parent = await item();
    await write('bind_attributes', parent, {
      target: { kind: 'ITEM', id: parent },
      template_id: 'container',
      template_version: 1,
      values: { can_contain: true },
      item_id: undefined,
    });
    for (const child of [food, durable, unknown])
      await write('move_item', child, { parent_id: parent });
    for (const direction of ['asc', 'desc']) {
      const ids: string[] = [];
      let cursor: string | undefined;
      do {
        const page = await execute(ctx, 'query_items', {
          within_item_id: parent,
          sort: { field: 'reminder_date', direction },
          limit: 1,
          cursor,
        });
        ids.push(...page.data.map((r: any) => r.id));
        if (page.data[0].id === durable) expect(page.data[0].reminder_date).toBe('2026-02-01');
        cursor = page.next_cursor ?? undefined;
      } while (cursor);
      expect(ids.slice(0, 2)).toEqual(direction === 'asc' ? [durable, food] : [food, durable]);
      expect(new Set(ids.slice(2))).toEqual(new Set([unknown, parent]));
    }
    await write('update_attributes', food, {
      item_id: undefined,
      target: { kind: 'ITEM', id: food },
      template_id: 'lifecycle',
      template_version: 1,
      unset: ['expiry.after_opening_days'],
    });
    expect((await facts(food)).map((r) => r.source_key)).toEqual(['lifecycle.expiry']);
  });

  it('uses the household calendar for DUE/OVERDUE/UPCOMING and validates timezone writes without rewriting values', async () => {
    const today = (
      await query(
        pool,
        "SELECT (CURRENT_TIMESTAMP AT TIME ZONE 'America/New_York')::date::text AS day",
      )
    ).rows[0].day;
    const item_id = await item();
    await add(item_id, { kind: 'REORDER_BY', due_on: today });
    expect((await scoped(item_id, [{ state: 'DUE', from: today, to: today }])).matching_count).toBe(
      1,
    );
    expect((await get(item_id)).dates[0].state).toBe('DUE');
    const past = await add(item_id, { kind: 'RETURN_BY', due_on: '2000-01-01' });
    await add(item_id, { kind: 'RENEWAL', due_on: '9999-01-01' });
    expect(
      (
        await scoped(item_id, [
          { state: 'OVERDUE', kind: 'RETURN_BY' },
          { state: 'UPCOMING', kind: 'RENEWAL' },
        ])
      ).matching_count,
    ).toBe(1);
    await write('remove_deadline', item_id, { entry_id: past });
    await expect(
      query(pool, 'UPDATE households SET timezone=$1 WHERE id=$2', [
        'Invalid/Zone',
        ctx.household_id,
      ]),
    ).rejects.toMatchObject({ cause: { code: '23514' } });
    await expect(
      query(pool, "INSERT INTO households(id,name,timezone) VALUES($1,'invalid','Invalid/Zone')", [
        `household_${randomUUID()}`,
      ]),
    ).rejects.toMatchObject({ cause: { code: '23514' } });
    const timezone = (
      await query(pool, 'SELECT timezone FROM households WHERE id=$1', [ctx.household_id])
    ).rows[0].timezone;
    expect(timezone).toBe('America/New_York');
  });

  it('handles legacy invalid timezone reads and rebuilds opening dates on valid timezone changes', async () => {
    const item_id = await item({
      opening: { opened_at: '2026-03-08T04:30:00Z' },
      expiry: { after_opening_days: 2 },
    });
    // Simulate a pre-014 invalid row without weakening validation for other connections.
    await transaction(async (c) => {
      await query(c, "SET LOCAL session_replication_role = 'replica'");
      await query(c, "UPDATE households SET timezone='Invalid/Legacy' WHERE id=$1", [
        ctx.household_id,
      ]);
    });
    await transaction((c) => rebuildDateFacts(c, ctx.household_id));
    expect((await get(item_id)).reminder_date).toBe('2026-03-10');
    expect(
      (await scoped(item_id, [], { sort: { field: 'reminder_date', direction: 'asc' } })).data[0]
        .reminder_date,
    ).toBe('2026-03-10');
    const revision = (await get(item_id)).revision;
    await query(pool, "UPDATE households SET timezone='America/New_York' WHERE id=$1", [
      ctx.household_id,
    ]);
    expect(await get(item_id)).toMatchObject({ reminder_date: '2026-03-09', revision });
  });

  it('MODEL03 rebuilds deterministically without core/event writes and rolls projection failures back atomically', async () => {
    const item_id = await item();
    const entry_id = await add(item_id, {
      kind: 'SERVICE_DUE',
      due_on: '2026-06-01',
      recurrence_days: 1,
    });
    const before = await get(item_id);
    const projected = await facts(item_id);
    // A real database failure after event insertion tests rollback of service, deadline, event, sync and receipt.
    await query(
      pool,
      `ALTER TABLE date_facts ADD CONSTRAINT batch5_reject_completed_service CHECK (item_id <> '${item_id}' OR due_on <> DATE '2026-06-03')`,
    );
    const key = randomUUID();
    try {
      await expect(
        write('complete_deadline', item_id, {
          entry_id,
          completed_on: '2026-06-02',
          idempotency_key: key,
        }),
      ).rejects.toBeDefined();
      expect(await get(item_id)).toEqual(before);
      expect(await facts(item_id)).toEqual(projected);
      expect(
        (
          await execute(ctx, 'get_history', {
            target: { kind: 'ITEM', id: item_id },
            event_type: 'COMPLETE_DEADLINE',
          })
        ).data,
      ).toEqual([]);
      expect(
        (
          await query(
            pool,
            'SELECT 1 FROM operations WHERE household_id=$1 AND idempotency_key=$2',
            [ctx.household_id, key],
          )
        ).rows,
      ).toEqual([]);
    } finally {
      await query(pool, 'ALTER TABLE date_facts DROP CONSTRAINT batch5_reject_completed_service');
    }
    await write('complete_deadline', item_id, {
      entry_id,
      completed_on: '2026-06-02',
      idempotency_key: key,
    });
    const after = await get(item_id);
    const rebuilt = await facts(item_id);
    await transaction(async (c) => {
      await query(c, 'DELETE FROM date_facts WHERE household_id=$1', [ctx.household_id]);
      await rebuildDateFacts(c, ctx.household_id);
    });
    // Backfill may advance the projection watermark to the household watermark; source facts stay identical.
    const source = (rows: any[]) => rows.map(({ projected_through_change_id, ...row }) => row);
    expect(source(await facts(item_id))).toEqual(source(rebuilt));
    expect(await get(item_id)).toEqual(after);
    await transaction((c) => rebuildDateFacts(c, ctx.household_id));
    expect(await get(item_id)).toEqual(after);
  });

  it('rejects implicit completions, index patches, invalid dates, duplicate IDs, and foreign entries', async () => {
    const item_id = await item();
    const entry_id = await add(item_id, { kind: 'WARRANTY_END', due_on: '2028-02-29' });
    const other = await item();
    await expect(write('complete_deadline', item_id, { entry_id })).rejects.toMatchObject({
      code: 'ATTRIBUTE_VALIDATION_FAILED',
    });
    await expect(
      write('update_deadline', item_id, { entry_id, patch: { due_on: '2027-02-29' } }),
    ).rejects.toMatchObject({ code: 'ATTRIBUTE_VALIDATION_FAILED' });
    await expect(
      write('update_deadline', item_id, { entry_id, patch: { last_completed_on: '2026-01-01' } }),
    ).rejects.toMatchObject({ code: 'ATTRIBUTE_VALIDATION_FAILED' });
    await expect(
      write('update_deadline', item_id, { entry_id: '0', patch: { due_on: '2026-01-01' } }),
    ).rejects.toMatchObject({ code: 'ATTRIBUTE_VALIDATION_FAILED' });
    await expect(write('remove_deadline', other, { entry_id })).rejects.toMatchObject({
      code: 'NOT_FOUND',
    });
    await expect(
      write('add_deadline', item_id, {
        entry: { kind: 'RENEWAL', due_on: '2026-01-01', recurrence_days: 0 },
      }),
    ).rejects.toMatchObject({ code: 'ATTRIBUTE_VALIDATION_FAILED' });
    expect(() =>
      parseCommand('update_attributes', {
        target: { kind: 'ITEM', id: item_id },
        template_id: 'deadline',
        template_version: 1,
        set: { 'entries.0.due_on': '2026-01-01' },
        expected_revisions: { [item_id]: 1 },
        idempotency_key: randomUUID(),
      }),
    ).toThrow();
    await expect(scoped(item_id, [{ from: '2026-02-01', to: '2026-01-01' }])).rejects.toMatchObject(
      { code: 'ATTRIBUTE_VALIDATION_FAILED' },
    );
  });

  it('advances from explicit completion across leap days and fall DST, with stable updates', async () => {
    const item_id = await item();
    const entry_id = await add(item_id, {
      kind: 'RENEWAL',
      due_on: '2020-01-01',
      recurrence_days: 1,
    });
    for (const [completed_on, due_on] of [
      ['2028-02-28', '2028-02-29'],
      ['2028-02-29', '2028-03-01'],
      ['2028-11-05', '2028-11-06'],
    ]) {
      await write('complete_deadline', item_id, { entry_id, completed_on });
      expect(values(await get(item_id), 'deadline').entries[0]).toMatchObject({
        id: entry_id,
        due_on,
        last_completed_on: completed_on,
      });
    }
    await write('update_deadline', item_id, {
      entry_id,
      patch: { basis: 'contract', note: 'renew', recurrence_days: null },
    });
    expect(values(await get(item_id), 'deadline').entries[0]).toMatchObject({
      id: entry_id,
      basis: 'contract',
      note: 'renew',
      recurrence_days: null,
    });
    expect((await get(item_id)).dates[0].state).toBe('COMPLETED');
    expect(() =>
      validateValues('deadline', {
        entries: [
          { id: entry_id, kind: 'RENEWAL', due_on: '2026-01-01' },
          { id: entry_id, kind: 'RETURN_BY', due_on: '2026-02-01' },
        ],
      }),
    ).toThrow();
  });

  it('allows projection maintenance under the deployed runtime role and has the actionable index', async () => {
    const item_id = await item({ expiry: { date: '2026-01-01' } });
    const before = await get(item_id);
    await transaction(async (c) => {
      await query(c, 'SET LOCAL ROLE acornary_app');
      await rebuildDateFacts(c, ctx.household_id);
    });
    expect(await get(item_id)).toEqual(before);
    const index = (
      await query(pool, "SELECT indexdef FROM pg_indexes WHERE indexname='date_facts_actionable'")
    ).rows[0].indexdef;
    expect(index).toContain('(household_id, due_on)');
    expect(index).toContain('WHERE (completed_on IS NULL)');
  });

  it('retains date filter cursor identity and household isolation', async () => {
    const first = await item();
    const second = await item();
    await add(first, { kind: 'RENEWAL', due_on: '2040-01-01' });
    await add(second, { kind: 'RENEWAL', due_on: '2040-01-01' });
    const input = {
      date_filters: [{ kind: 'RENEWAL', from: '2040-01-01', to: '2040-01-01' }],
      limit: 1,
    };
    const page = await execute(ctx, 'query_items', input);
    expect(page.matching_count).toBe(2);
    await expect(
      execute(ctx, 'query_items', {
        ...input,
        date_filters: [{ kind: 'RETURN_BY' }],
        cursor: page.next_cursor,
      }),
    ).rejects.toMatchObject({ code: 'INVALID_CURSOR' });
    const other = {
      ...(await transaction((c) => createHousehold(c, 'Other dates'))),
      source: 'TEST',
    };
    expect((await execute(other, 'query_items', input)).matching_count).toBe(0);
    await expect(execute(other, 'get_item', { item_id: first })).rejects.toMatchObject({
      code: 'NOT_FOUND',
    });
    await expect(
      execute(other, 'add_deadline', {
        item_id: first,
        entry: { kind: 'RETURN_BY', due_on: '2026-01-01' },
        expected_revisions: { [first]: 2 },
        idempotency_key: randomUUID(),
      }),
    ).rejects.toMatchObject({ code: 'NOT_FOUND' });
  });
});
