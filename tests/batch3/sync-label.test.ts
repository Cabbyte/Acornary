import { randomUUID } from 'node:crypto';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { pool, query, transaction } from '../../apps/server/src/db.js';
import { initialize, createHousehold } from '../../apps/server/src/initialize.js';
import { execute, type Context } from '../../apps/server/src/service.js';
import {
  syncState,
  syncChanges,
  syncBootstrap,
  syncFetch,
  publishSyncTombstone,
} from '../../apps/server/src/sync-api.js';
import {
  captureLabelBackfill,
  applyLabelBackfill,
  labelHash,
} from '../../apps/server/src/label-projection.js';
import { terminalSnapshot } from '../../apps/server/src/terminal.js';
import { webSnapshotV2 } from '../../apps/server/src/web.js';
import { terminalLabelTimes } from '../batch0/label-oracle.js';
import { approvedExecute, approvedInput } from '../catalog-helpers.js';
import { buildApp } from '../../apps/server/src/app.js';
import type { Operation } from '../../packages/contracts/src/index.js';

const db = describe.skipIf(!process.env.DATABASE_URL);
db('Batch 3 sync and labels (real PostgreSQL)', () => {
  let ctx: Context, sku: string;
  const write = (name: Operation, input: any) =>
    approvedExecute(ctx, name, { idempotency_key: randomUUID(), ...input });
  const create = async (count = 1, extra: any = {}) =>
    (await write('create_items', { catalog_node_id: sku, count, ...extra })).affected_objects.map(
      (o: any) => o.id,
    ) as string[];
  const rows = async () =>
    (await query(pool, 'SELECT * FROM items WHERE household_id=$1 ORDER BY id', [ctx.household_id]))
      .rows;
  const update = async (id: string, name: Operation, extra: any) => {
    const item = (await rows()).find((i) => i.id === id)!;
    return write(name, { item_id: id, expected_revisions: { [id]: item.revision }, ...extra });
  };
  const renameSku = async (name: string) => {
    const row = (await query(pool, 'SELECT revision FROM catalog_nodes WHERE id=$1', [sku]))
      .rows[0];
    return write('update_catalog_node', {
      catalog_node_id: sku,
      name,
      expected_revisions: { [sku]: row.revision },
    });
  };
  const bind = (template_id: string, values: any) => ({ template_id, template_version: 1, values });
  beforeAll(async () => {
    if (!new URL(process.env.DATABASE_URL!).pathname.includes('acornary_test'))
      throw new Error('Isolated test DB required');
    await initialize();
  }, 30000);
  beforeEach(async () => {
    const h = await transaction((c) => createHousehold(c, 'batch3'));
    ctx = { household_id: h.household_id, actor_id: h.actor_id, source: 'TEST' };
    sku = (await write('create_catalog_node', { kind: 'SKU', name: 'Label SKU' }))
      .affected_objects[0].id;
  });
  afterAll(() => pool.end());

  async function assertOracle() {
    const snapshot = await webSnapshotV2(ctx);
    const events = (
      await query(pool, 'SELECT * FROM events WHERE household_id=$1', [ctx.household_id])
    ).rows;
    const expected = terminalLabelTimes(snapshot, events);
    const actual = await rows();
    const catalog = new Map(snapshot.catalog.map((c) => [c.id, c]));
    for (const item of actual) {
      expect(new Date(item.label_updated_at).toISOString(), item.id).toBe(expected.get(item.id));
      expect(item.label_hash, item.id).toBe(labelHash(item, catalog.get(item.catalog_node_id)));
    }
    return { expected, actual };
  }
  async function allBootstrap(limit = 1, onPage?: (page: any) => Promise<void>) {
    let cursor: string | undefined;
    const result: any = { catalog: [], items: [], groups: [] };
    do {
      const page = await syncBootstrap(ctx, { limit, ...(cursor ? { cursor } : {}) });
      for (const key of ['catalog', 'items', 'groups'] as const) result[key].push(...page[key]);
      result.generation = page.generation;
      result.as_of_change_id ??= page.as_of_change_id;
      expect(page.as_of_change_id).toBe(result.as_of_change_id);
      await onPage?.(page);
      cursor = page.next_cursor ?? undefined;
    } while (cursor);
    return result;
  }

  it('SYNC01/03: bootstrap uses stable identity pages; changed already-read records are caught up at S', async () => {
    await create(3);
    let edited = false,
      changedId = '';
    const base = await allBootstrap(1, async (page) => {
      if (!edited && page.items.length) {
        edited = true;
        changedId = page.items[0].id;
        await update(changedId, 'update_item', { display_name: 'Sorts elsewhere' });
      }
    });
    expect(new Set(base.items.map((i: any) => i.id)).size).toBe(3);
    const delta = await syncChanges(ctx, {
      generation: base.generation,
      cursor: base.as_of_change_id,
    });
    expect(delta.changes.map((c) => c.object_id)).toContain(changedId);
    const fetched = await syncFetch(ctx, {
      generation: base.generation,
      ids: [{ kind: 'ITEM', id: changedId }],
    });
    expect(fetched.objects[0]).toMatchObject({
      display_name: 'Sorts elsewhere',
      last_change_id: delta.changes.at(-1)!.change_id,
    });
    expect(BigInt(fetched.objects[0].last_change_id)).toBeGreaterThan(
      BigInt(base.items.find((i: any) => i.id === changedId).last_change_id),
    );
  });

  it('SYNC02: tombstone during bootstrap excludes the unread object and contains identity only', async () => {
    const [id] = await create();
    let deleted = false;
    const base = await allBootstrap(1, async (page) => {
      if (!deleted && page.catalog.length) {
        deleted = true;
        await transaction((c) =>
          publishSyncTombstone(c, ctx.household_id, 'ITEM', id, 2, 'operation_' + randomUUID()),
        );
      }
    });
    expect(base.items).toEqual([]);
    const delta = await syncChanges(ctx, {
      generation: base.generation,
      cursor: base.as_of_change_id,
    });
    expect(delta.changes).toHaveLength(1);
    expect(Object.keys(delta.changes[0]).sort()).toEqual(
      ['change_id', 'object_id', 'object_kind', 'revision', 'change_kind'].sort(),
    );
    expect(delta.changes[0].change_kind).toBe('TOMBSTONE');
    expect(
      (await syncFetch(ctx, { generation: base.generation, ids: [{ kind: 'ITEM', id }] })).objects,
    ).toEqual([]);
  });

  it('SYNC04/06: two writers commit in reverse global sequence order; household watermarks and holes stay valid', async () => {
    const other = await transaction((c) => createHousehold(c, 'other'));
    const a = await pool.connect(),
      b = await pool.connect();
    const before = await syncState(ctx);
    try {
      await a.query('BEGIN');
      await b.query('BEGIN');
      await publishSyncTombstone(
        a,
        ctx.household_id,
        'ITEM',
        'item_' + randomUUID(),
        1,
        'operation_' + randomUUID(),
      );
      await publishSyncTombstone(
        b,
        other.household_id,
        'ITEM',
        'item_' + randomUUID(),
        1,
        'operation_' + randomUUID(),
      );
      await b.query('COMMIT');
      expect((await syncState(ctx)).last_change_id).toBe(before.last_change_id);
      await a.query('COMMIT');
      const after = await syncState(ctx);
      const otherState = await syncState({ ...other, source: 'TEST' });
      expect(BigInt(after.last_change_id)).toBeLessThan(BigInt(otherState.last_change_id));
      // Rollback consumes a global sequence number without exposing it in this household.
      await a.query('BEGIN');
      await publishSyncTombstone(
        a,
        ctx.household_id,
        'ITEM',
        'item_' + randomUUID(),
        1,
        'operation_' + randomUUID(),
      );
      await a.query('ROLLBACK');
      await create();
      const delta = await syncChanges(ctx, {
        generation: after.generation,
        cursor: after.last_change_id,
      });
      expect(delta.changes).toHaveLength(1);
      expect(BigInt(delta.changes[0].change_id) - BigInt(after.last_change_id)).toBeGreaterThan(1n);
    } finally {
      await a.query('ROLLBACK').catch(() => {});
      await b.query('ROLLBACK').catch(() => {});
      a.release();
      b.release();
    }
  });

  it('SYNC05/10: retryable pages use a fixed catch-up boundary, including a batch across pages', async () => {
    const start = await syncState(ctx);
    await create(3);
    const first = await syncChanges(ctx, {
      generation: start.generation,
      cursor: start.last_change_id,
      limit: 1,
    });
    const request = {
      generation: start.generation,
      cursor: first.next_cursor!,
      limit: 1,
      as_of_change_id: first.as_of_change_id,
    };
    const page = await syncChanges(ctx, request);
    await create();
    expect(await syncChanges(ctx, request)).toEqual(page);
    const last = await syncChanges(ctx, { ...request, cursor: page.next_cursor! });
    expect(last.has_more).toBe(false);
    expect(last.as_of_change_id).toBe(first.as_of_change_id);
    expect(
      (await syncChanges(ctx, { generation: start.generation, cursor: last.as_of_change_id }))
        .changes,
    ).toHaveLength(1);
  });

  it('SYNC07: prune only a continuous 30-day prefix; equality remains valid', async () => {
    await create(3);
    const s = await syncState(ctx);
    const changes = (await syncChanges(ctx, { generation: s.generation, cursor: '0' })).changes;
    // Deliberately out-of-order times: an old row after a recent row must survive.
    await query(
      pool,
      "UPDATE sync_changes SET created_at=now()-interval '31 days' WHERE household_id=$1 AND change_id=ANY($2::bigint[])",
      [ctx.household_id, [changes[0].change_id, changes[2].change_id]],
    );
    await query(pool, 'SELECT prune_household_sync($1)', [ctx.household_id]);
    const next = await syncState(ctx);
    expect(next.min_available_change_id).toBe(changes[0].change_id);
    expect(
      (await syncChanges(ctx, { generation: s.generation, cursor: next.min_available_change_id }))
        .changes,
    ).toHaveLength(3);
    await expect(syncChanges(ctx, { generation: s.generation, cursor: '0' })).rejects.toMatchObject(
      { code: 'SYNC_RESET_REQUIRED', details: { reason: 'CURSOR_PRUNED' } },
    );
    expect((await rows())[0].label_hash).toBeTruthy();
    const fetched = await syncFetch(ctx, {
      generation: s.generation,
      ids: [{ kind: 'CATALOG_NODE', id: sku }],
    });
    expect(fetched.objects[0].last_change_id).toBe(changes[0].change_id);
  });

  it('SYNC08: restore reset invalidates changes/fetch/bootstrap; future and foreign cursors reject', async () => {
    await create();
    const first = await syncBootstrap(ctx, { limit: 1 });
    const before = await syncState(ctx);
    await expect(
      syncChanges(ctx, {
        generation: before.generation,
        cursor: (BigInt(before.last_change_id) + 1n).toString(),
      }),
    ).rejects.toMatchObject({ code: 'SYNC_RESET_REQUIRED' });
    const other = await transaction((c) => createHousehold(c, 'other'));
    await expect(
      syncBootstrap({ ...other, source: 'TEST' }, { cursor: first.next_cursor }),
    ).rejects.toMatchObject({ code: 'INVALID_CURSOR' });
    await query(pool, 'SELECT reset_household_sync($1)', [ctx.household_id]);
    const after = await syncState(ctx);
    expect(after.generation).not.toBe(before.generation);
    await expect(
      syncChanges(ctx, { generation: before.generation, cursor: before.last_change_id }),
    ).rejects.toMatchObject({ code: 'SYNC_RESET_REQUIRED' });
    await expect(syncFetch(ctx, { generation: before.generation, ids: [] })).rejects.toMatchObject({
      code: 'SYNC_RESET_REQUIRED',
    });
    await expect(syncBootstrap(ctx, { cursor: first.next_cursor })).rejects.toMatchObject({
      code: 'SYNC_RESET_REQUIRED',
    });
  });

  it('SYNC09/LABEL02: SKU rename refreshes inherited labels but preserves custom labels and core revisions', async () => {
    const [inherited] = await create();
    const [custom] = await create(1, { display_name: 'Personal' });
    const before = await rows();
    const start = await syncState(ctx);
    await renameSku('Renamed');
    const delta = await syncChanges(ctx, {
      generation: start.generation,
      cursor: start.last_change_id,
    });
    expect(delta.changes.map((c) => c.object_id).sort()).toEqual([sku, inherited].sort());
    const after = await rows();
    expect(after.every((i) => i.revision === 1)).toBe(true);
    expect(after.find((i) => i.id === custom).label_updated_at).toEqual(
      before.find((i) => i.id === custom).label_updated_at,
    );
    expect(after.find((i) => i.id === inherited).label_updated_at).not.toEqual(
      before.find((i) => i.id === inherited).label_updated_at,
    );
    await assertOracle();
  });

  it('SYNC12: no-op, replay and rolled-back batches publish no new references', async () => {
    const input = {
      idempotency_key: randomUUID(),
      catalog_node_id: sku,
      count: 1,
      display_name: 'same',
    };
    const first = await execute(ctx, 'create_items', input);
    const [id] = first.affected_objects.map((o: any) => o.id);
    const start = await syncState(ctx);
    expect(await execute(ctx, 'create_items', input)).toEqual(first);
    await update(id, 'update_item', { display_name: 'same' });
    await expect(
      write('create_items_batch', {
        items: ['x', 'x'].map((client_ref) => ({ client_ref, catalog_node_id: sku })),
      }),
    ).rejects.toMatchObject({ code: 'ATTRIBUTE_VALIDATION_FAILED' });
    expect(await syncState(ctx)).toEqual(start);
    expect(await rows()).toHaveLength(1);
  });

  it('LABEL03/04/05: null, empty and whitespace; same-value SKU reassignment; no-date kind changes', async () => {
    const ids = await create(3);
    // Legacy storage accepts these values even though ordinary writes normalize user text.
    await query(
      pool,
      "UPDATE items SET display_name=CASE id WHEN $2 THEN '' WHEN $3 THEN '   ' ELSE NULL END,label_hash=NULL WHERE household_id=$1",
      [ctx.household_id, ids[1], ids[2]],
    );
    await applyLabelBackfill(await captureLabelBackfill(ctx.household_id));
    const before = await rows();
    const another = (await write('create_catalog_node', { kind: 'SKU', name: 'Label SKU' }))
      .affected_objects[0].id;
    await update(ids[0], 'correct_item', {
      reason: 'same tuple',
      core: { catalog_node_id: another },
    });
    await write('bind_attributes', {
      target: { kind: 'ITEM', id: ids[1] },
      ...bind('lifecycle', { expiry: { date_kind: 'USE_BY' } }),
      expected_revisions: { [ids[1]]: 1 },
    });
    const after = await rows();
    expect(after.map((i) => i.label_updated_at)).toEqual(before.map((i) => i.label_updated_at));
    expect(after.find((i) => i.id === ids[0]).label_hash).toBe(
      after.find((i) => i.id === ids[1]).label_hash,
    );
    expect(after.find((i) => i.id === ids[2]).label_hash).not.toBe(
      after.find((i) => i.id === ids[1]).label_hash,
    );
    await assertOracle();
  });

  it('LABEL06: position, notes, remaining contents and opening preserve label timestamps', async () => {
    const [parent] = await create(1, {
      initial_attributes: [bind('container', { can_contain: true })],
    });
    const [id] = await create(1, {
      initial_attributes: [
        bind('lifecycle', { opening: { state: 'SEALED' } }),
        bind('contents', { remaining: { value: '100', unit: 'g' }, accuracy: 'MEASURED' }),
      ],
    });
    const before = (await rows()).find((i) => i.id === id).label_updated_at;
    await update(id, 'move_item', { parent_id: parent });
    await update(id, 'add_note', { body: 'Private text' });
    await update(id, 'consume_item_content', { amount: { value: '1', unit: 'g' } });
    await update(id, 'open_item', {});
    expect((await rows()).find((i) => i.id === id).label_updated_at).toEqual(before);
    await assertOracle();
  });

  it('LABEL08: two-connection backfill snapshot cannot overwrite a newer foreground write', async () => {
    const [id] = await create();
    await query(pool, 'UPDATE items SET label_hash=NULL,label_updated_at=NULL WHERE id=$1', [id]);
    const reader = await pool.connect();
    try {
      await reader.query('BEGIN ISOLATION LEVEL REPEATABLE READ READ ONLY');
      const old = (await reader.query('SELECT label_hash FROM items WHERE id=$1', [id])).rows[0];
      const captured = await captureLabelBackfill(ctx.household_id);
      await update(id, 'update_item', { display_name: 'Newer' });
      const newer = (await rows())[0];
      expect(newer.label_hash).toBeTruthy();
      expect(
        (await reader.query('SELECT label_hash FROM items WHERE id=$1', [id])).rows[0],
      ).toEqual(old);
      await applyLabelBackfill(captured, 1);
      expect((await rows())[0].label_hash).toBe(newer.label_hash);
      expect((await rows())[0].label_updated_at).toEqual(newer.label_updated_at);
      await applyLabelBackfill(captured, 1); // resumable replay
      await assertOracle();
    } finally {
      await reader.query('ROLLBACK');
      reader.release();
    }
  });

  it('LABEL01/09: independent frozen oracle comparison, creation floor and seven-day terminal set', async () => {
    const ids = await create(2);
    await update(ids[0], 'update_item', {
      display_name: 'Changed',
      occurred_at: '2000-01-01T00:00:00Z',
    });
    // Synthetic incomplete legacy history: creation newer than the recorded label event.
    await query(
      pool,
      "UPDATE items SET created_at=now()+interval '1 hour',label_hash=NULL,label_updated_at=NULL WHERE id=$1",
      [ids[0]],
    );
    await query(
      pool,
      "UPDATE items SET created_at=now()-interval '8 days',label_hash=NULL,label_updated_at=NULL WHERE id=$1",
      [ids[1]],
    );
    await applyLabelBackfill(await captureLabelBackfill(ctx.household_id), 1);
    const { expected, actual } = await assertOracle();
    const terminal = await terminalSnapshot(ctx);
    const cutoff = Date.now() - 7 * 86400000;
    expect(
      terminal.items
        .filter((i) => Date.parse(i.label_updated_at) >= cutoff)
        .map((i) => i.id)
        .sort(),
    ).toEqual(
      [...expected]
        .filter(([, time]) => Date.parse(time) >= cutoff)
        .map(([id]) => id)
        .sort(),
    );
    expect(
      new Date(actual.find((i) => i.id === ids[0]).label_updated_at).getTime(),
    ).toBeGreaterThanOrEqual(new Date(actual.find((i) => i.id === ids[0]).created_at).getTime());
  });

  it('snapshot v2, groups and HTTP negotiation never inline note bodies', async () => {
    const [id] = await create(1, {
      initial_attributes: [bind('contents', { remaining: { value: '0.1', unit: 'g' } })],
    });
    const note = await update(id, 'add_note', { body: 'Only note searchable Ω' });
    await create(1, {
      initial_attributes: [bind('contents', { remaining: { value: '0.2', unit: 'g' } })],
    });
    const group = await execute(ctx, 'query_inventory_groups', { search: 'Ω' });
    const matching = await execute(ctx, 'query_items', { search: 'Ω' });
    expect(group.groups[0].count).toBe(matching.matching_count);
    const all = await execute(ctx, 'query_inventory_groups', {});
    expect(all.groups[0].totals[0].value).toBe('0.3');
    expect(all.groups[0]).not.toHaveProperty('item_ids');
    const app = await buildApp(ctx, 'test-token', false, { mode: 'local' });
    try {
      expect((await app.inject({ url: '/api/ui/snapshot' })).statusCode).toBe(409);
      const v2 = (
        await app.inject({ url: '/api/ui/snapshot', headers: { 'x-acornary-protocol': '2' } })
      ).json();
      expect(v2.protocol).toBe(2);
      expect(v2).not.toHaveProperty('notes');
      expect(JSON.stringify(v2)).not.toContain('Only note');
      expect(v2.items.find((i: any) => i.id === id).note_count).toBe(1);
      expect(v2.groups).toEqual(all.groups);
      expect(
        (
          await app.inject({ method: 'POST', url: '/api/read/query_inventory_groups', payload: {}, headers: { 'x-acornary-protocol': '2' } })
        ).json().groups,
      ).toEqual(all.groups);
      expect((await app.inject({ url: '/api/sync/state' })).statusCode).toBe(409);
      const s = await syncState(ctx);
      const fetchedNote = await syncFetch(ctx, {
        generation: s.generation,
        ids: [{ kind: 'NOTE', id: note.note_id }],
      });
      expect(fetchedNote.objects[0]).toMatchObject({
        excerpt: 'Only note searchable Ω',
        archived: false,
        sensitivity: 'NORMAL',
        updated_by: ctx.actor_id,
      });
      expect(fetchedNote.objects[0]).not.toHaveProperty('body');
      const reset = await app.inject({
        url: `/api/sync/changes?generation=${randomUUID()}&cursor=0`,
        headers: { 'x-acornary-protocol': '2' },
      });
      expect(reset.statusCode).toBe(409);
      expect(reset.json().error.code).toBe('SYNC_RESET_REQUIRED');
      const foreign = await transaction((c) => createHousehold(c, 'other'));
      const foreignId = (
        await execute({ ...foreign, source: 'TEST' }, 'create_items', {
          catalog_node_id: foreign.container_catalog_id,
          count: 1,
          idempotency_key: randomUUID(),
        })
      ).affected_objects[0].id;
      expect(
        (await syncFetch(ctx, { generation: s.generation, ids: [{ kind: 'ITEM', id: foreignId }] }))
          .objects,
      ).toEqual([]);
    } finally {
      await app.close();
    }
  });

  it('LABEL07/SYNC10: 500-item specification fan-out is atomic to a third connection', async () => {
    for (let n = 0; n < 5; n++) await create(100, n === 0 ? { display_name: 'Custom' } : {});
    const before = await rows();
    const s = await syncState(ctx);
    const rev = (await query(pool, 'SELECT revision FROM catalog_nodes WHERE id=$1', [sku])).rows[0]
      .revision;
    const input = await approvedInput(ctx, 'bind_attributes', {
      idempotency_key: randomUUID(),
      target: { kind: 'CATALOG_NODE', id: sku },
      ...bind('product', { specification: '500 g' }),
      expected_revisions: { [sku]: rev },
    });
    const gate = await pool.connect(),
      observer = await pool.connect();
    const suffix = randomUUID().replaceAll('-', '');
    const functionName = 'batch3_pause_' + suffix;
    const triggerName = 'batch3_pause_' + suffix;
    const gateKey = 'batch3:' + suffix;
    // Pause a genuine service write midway through projection; a third connection must see all old rows.
    await gate.query(`CREATE FUNCTION ${functionName}() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN
      IF NEW.id='${before[250].id}' AND NEW.label_hash IS DISTINCT FROM OLD.label_hash THEN
        PERFORM pg_advisory_xact_lock(hashtextextended('${gateKey}',0)); END IF; RETURN NEW; END $$`);
    await gate.query(
      `CREATE TRIGGER ${triggerName} BEFORE UPDATE OF label_hash ON items FOR EACH ROW EXECUTE FUNCTION ${functionName}()`,
    );
    let writing: Promise<any> | undefined;
    try {
      await gate.query('BEGIN');
      await gate.query('SELECT pg_advisory_xact_lock(hashtextextended($1,0))', [gateKey]);
      writing = execute(ctx, 'bind_attributes', input);
      let blocked = false;
      for (let attempt = 0; attempt < 300; attempt++) {
        blocked =
          (
            await observer.query(
              "SELECT 1 FROM pg_stat_activity WHERE datname=current_database() AND wait_event='advisory' AND query LIKE '%UPDATE items SET label_hash%'",
            )
          ).rows.length > 0;
        if (blocked) break;
        await new Promise((resolve) => setTimeout(resolve, 10));
      }
      expect(blocked).toBe(true);
      expect(
        (
          await observer.query('SELECT label_hash FROM items WHERE household_id=$1 ORDER BY id', [
            ctx.household_id,
          ])
        ).rows.map((i) => i.label_hash),
      ).toEqual(before.map((i) => i.label_hash));
      expect((await syncState(ctx)).last_change_id).toBe(s.last_change_id);
      await gate.query('COMMIT');
      await writing;
      const after = await rows();
      expect(
        after.every(
          (i, n) => i.label_hash !== before[n].label_hash && i.revision === before[n].revision,
        ),
      ).toBe(true);
      let cursor = s.last_change_id,
        count = 0,
        high: string | undefined;
      do {
        const page = await syncChanges(ctx, {
          generation: s.generation,
          cursor,
          limit: 200,
          ...(high ? { as_of_change_id: high } : {}),
        });
        high ??= page.as_of_change_id;
        count += page.changes.length;
        cursor = page.next_cursor ?? '';
      } while (cursor);
      expect(count).toBe(501);
      await assertOracle();
    } finally {
      await gate.query('ROLLBACK').catch(() => {});
      await writing?.catch(() => {});
      await query(pool, `DROP TRIGGER ${triggerName} ON items`);
      await query(pool, `DROP FUNCTION ${functionName}()`);
      gate.release();
      observer.release();
    }
  }, 30000);

  it('group pages preserve the matching set, validate query identity and report stale watermarks', async () => {
    await create(2);
    const otherSku = (await write('create_catalog_node', { kind: 'SKU', name: 'Another' }))
      .affected_objects[0].id;
    await write('create_items', { catalog_node_id: otherSku, count: 3 });
    const first = await execute(ctx, 'query_inventory_groups', { limit: 1 });
    expect(first.matching_group_count).toBe(2);
    expect(first.groups).toHaveLength(1);
    await create();
    const next = await execute(ctx, 'query_inventory_groups', {
      limit: 1,
      cursor: first.next_cursor,
    });
    expect(next.stale).toBe(true);
    expect(next.groups[0].id).not.toBe(first.groups[0].id);
    await expect(
      execute(ctx, 'query_inventory_groups', { cursor: first.next_cursor, search: 'changed' }),
    ).rejects.toMatchObject({ code: 'INVALID_CURSOR' });
    for (const input of [
      { catalog_node_ids: [sku] },
      { name: 'Another' },
      { search: 'Label', name: 'SKU' },
    ]) {
      const items = await execute(ctx, 'query_items', input);
      const groups = await execute(ctx, 'query_inventory_groups', input);
      expect(groups.groups.reduce((n: number, g: any) => n + g.count, 0)).toBe(
        items.matching_count,
      );
    }
  });

  it('cloud sync routes share session authentication and cannot fall back to the local context', async () => {
    const app = await buildApp(ctx, 'not-a-cloud-credential', false, {
      mode: 'cloud',
      origin: 'https://batch3.example.test',
      resource: 'https://batch3.example.test/mcp',
      secret: 'batch3-secret-that-is-more-than-thirty-two-characters',
      trustedProxy: '127.0.0.1',
    });
    try {
      for (const endpoint of ['state', 'changes', 'bootstrap', 'fetch']) {
        const res = await app.inject({
          method: endpoint === 'fetch' ? 'POST' : 'GET',
          url: '/api/sync/' + endpoint,
          headers: {
            host: 'batch3.example.test',
            'x-forwarded-proto': 'https',
            'x-acornary-protocol': '2',
          },
          ...(endpoint === 'fetch' ? { payload: { generation: randomUUID(), ids: [] } } : {}),
        });
        expect(res.statusCode).toBe(401);
      }
    } finally {
      await app.close();
    }
  });

  it('SYNC06: change IDs above JS safe integer and across decimal lengths retain numeric order', async () => {
    const start = await syncState(ctx);
    // This is the dedicated isolated DB's sequence, never a production connection.
    await query(
      pool,
      "SELECT setval('sync_changes_change_id_seq',greatest((SELECT last_value+1 FROM sync_changes_change_id_seq),9999999999999998),false)",
    );
    await create(3);
    const delta = await syncChanges(ctx, {
      generation: start.generation,
      cursor: start.last_change_id,
    });
    expect(delta.changes).toHaveLength(3);
    const ids = delta.changes.map((c) => BigInt(c.change_id));
    expect(ids[0]).toBeGreaterThan(9007199254740991n);
    expect(ids[1]).toBe(ids[0] + 1n);
    expect(ids[2]).toBe(ids[1] + 1n);
    expect(delta.as_of_change_id).toBe(ids[2].toString());
    expect((await syncState(ctx)).last_change_id).toBe(ids[2].toString());
  });

  it.skip('SYNC05 client: IndexedDB/Room page+cursor atomic crash recovery (outside backend lane)', () => {});
  it.skip('SYNC10 client: publish only completed catch-up rounds (outside backend lane)', () => {});
  it.skip('SYNC11 client: 20 nonempty rounds and exponential backoff (outside backend lane)', () => {});
  it.skip('LABEL01 production-copy full comparison requires a supplied production replica', () => {});
});
