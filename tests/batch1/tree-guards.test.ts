import { randomUUID } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import pg from 'pg';
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from 'vitest';

const databaseUrl = process.env.BATCH1_TEST_DATABASE_URL ?? process.env.DATABASE_URL;
const migration = (name: string) =>
  readFile(new URL(`../../migrations/${name}`, import.meta.url), 'utf8');
const id = (kind: string) => `${kind}_${randomUUID()}`;
const capable = JSON.stringify([{ template_id: 'container', values: { can_contain: true } }]);
const treeError = (prefix: string) => ({
  code: '23514',
  message: expect.stringMatching(`^${prefix}:`),
});
type Statement = [string, unknown[]?];
const move = (table: 'items' | 'catalog_nodes', child: string, parent: string): Statement => [
  `UPDATE ${table} SET parent_id=$2 WHERE id=$1`,
  [child, parent],
];
const settle = (query: Promise<pg.QueryResult>) =>
  query.then(
    () => ({ ok: true as const }),
    (error: unknown) => ({ ok: false as const, error }),
  );

// Uses real production migrations in a disposable database: 002 explicitly
// targets public, so a search_path-only schema sandbox would be misleading.
describe.skipIf(!databaseUrl)('Batch 1 direct-SQL tree guards', () => {
  const database = `acornary_test_tree_${randomUUID().replaceAll('-', '')}`;
  let admin: pg.Client;
  let a: pg.Client;
  let b: pg.Client;
  let observer: pg.Client;
  const connected: pg.Client[] = [];
  let created = false;
  let aPid: number;
  let bPid: number;
  let household: string;
  let sku: string;
  let itemA: string;
  let itemB: string;
  let itemC: string;
  let groupA: string;
  let groupB: string;
  const malformedHousehold = id('household');
  const malformedSku = id('catalog_node');
  const malformedItems = [id('item'), id('item')];
  const malformedGroups = [id('catalog_node'), id('catalog_node')];

  const connect = async (connectionString: string) => {
    const client = new pg.Client({
      connectionString,
      connectionTimeoutMillis: 5000,
      statement_timeout: 6000,
    });
    await client.connect();
    connected.push(client);
    return client;
  };
  const insertCatalog = (
    client: pg.Client,
    node: string,
    hh: string,
    kind = 'SKU',
    parent: string | null = null,
  ) =>
    client.query(
      'INSERT INTO catalog_nodes(id,household_id,kind,name,parent_id) VALUES($1,$2,$3,$1,$4)',
      [node, hh, kind, parent],
    );
  const insertItem = (
    client: pg.Client,
    item: string,
    hh: string,
    catalog: string,
    parent: string | null = null,
    attributes = capable,
  ) =>
    client.query(
      'INSERT INTO items(id,household_id,catalog_node_id,parent_id,attributes) VALUES($1,$2,$3,$4,$5::jsonb)',
      [item, hh, catalog, parent, attributes],
    );
  const snapshot = async () => ({
    items: (
      await observer.query('SELECT * FROM items WHERE household_id=$1 ORDER BY id', [household])
    ).rows,
    catalog: (
      await observer.query('SELECT * FROM catalog_nodes WHERE household_id=$1 ORDER BY id', [
        household,
      ])
    ).rows,
  });

  beforeAll(async () => {
    admin = await connect(databaseUrl!);
    await admin.query(`CREATE DATABASE ${database}`);
    created = true;
    const url = new URL(databaseUrl!);
    url.pathname = `/${database}`;
    a = await connect(url.toString());
    b = await connect(url.toString());
    observer = await connect(url.toString());
    for (const client of [a, b, observer])
      await client.query("SET default_transaction_isolation = 'read committed'");
    aPid = (await a.query('SELECT pg_backend_pid() AS pid')).rows[0].pid;
    bPid = (await b.query('SELECT pg_backend_pid() AS pid')).rows[0].pid;
    for (const name of [
      '001_initial.sql',
      '002_unified_ids.sql',
      '003_embed_attributes.sql',
      '004_cloud_auth.sql',
      '005_accounts.sql',
      '007_product_v2.sql',
      '008_intake_policy.sql',
    ]) {
      await a.query('BEGIN');
      await a.query(await migration(name));
      await a.query('COMMIT');
    }
    // Deliberately seed legacy corruption BEFORE installing the guards. No
    // trigger is disabled, including during subsequent acceptance tests.
    await a.query("INSERT INTO households(id,name,timezone) VALUES($1,'legacy','UTC')", [
      malformedHousehold,
    ]);
    await insertCatalog(a, malformedSku, malformedHousehold);
    for (const node of malformedGroups) await insertCatalog(a, node, malformedHousehold, 'GROUP');
    for (const item of malformedItems) await insertItem(a, item, malformedHousehold, malformedSku);
    for (const [table, nodes] of [
      ['items', malformedItems],
      ['catalog_nodes', malformedGroups],
    ] as const) {
      await a.query(`UPDATE ${table} SET parent_id=$2 WHERE id=$1`, [nodes[0], nodes[1]]);
      await a.query(`UPDATE ${table} SET parent_id=$2 WHERE id=$1`, [nodes[1], nodes[0]]);
    }
    await a.query('BEGIN');
    await a.query(await migration('010_tree_guards.sql'));
    await a.query('COMMIT');
  }, 30000);

  beforeEach(async () => {
    household = id('household');
    sku = id('catalog_node');
    [itemA, itemB, itemC] = [id('item'), id('item'), id('item')];
    [groupA, groupB] = [id('catalog_node'), id('catalog_node')];
    await a.query("INSERT INTO households(id,name,timezone) VALUES($1,'tree tests','UTC')", [
      household,
    ]);
    await insertCatalog(a, sku, household);
    for (const node of [groupA, groupB]) await insertCatalog(a, node, household, 'GROUP');
    for (const item of [itemA, itemB, itemC]) await insertItem(a, item, household, sku);
  });
  afterEach(async () => {
    if (observer && bPid) await observer.query('SELECT pg_cancel_backend($1)', [bPid]);
    if (a) await a.query('ROLLBACK');
    if (b) await b.query('ROLLBACK');
  });
  afterAll(async () => {
    try {
      for (const client of connected.filter((client) => client !== admin)) await client.end();
      if (created) await admin.query(`DROP DATABASE ${database}`);
    } finally {
      if (admin) await admin.end();
    }
  }, 30000);

  async function waitForHouseholdLock() {
    const deadline = Date.now() + 3000;
    while (Date.now() < deadline) {
      const locks = await observer.query(
        `
        SELECT 1 FROM pg_locks waiting JOIN pg_locks held
          USING (locktype, database, classid, objid, objsubid)
        WHERE waiting.pid=$1 AND held.pid=$2 AND waiting.locktype='advisory'
          AND NOT waiting.granted AND held.granted
          AND waiting.classid=((hashtextextended($3,0) >> 32) & 4294967295)::oid
          AND waiting.objid=(hashtextextended($3,0) & 4294967295)::oid
          AND waiting.objsubid=1`,
        [bPid, aPid, household],
      );
      if (locks.rowCount) return;
      await new Promise((resolve) => setTimeout(resolve, 10)); // Poll an observed barrier, never guess overlap.
    }
    throw new Error('B did not wait on A holding the service household advisory key');
  }

  async function race(
    first: Statement,
    second: Statement,
    prefix?: string,
    beforeSecond?: Statement,
  ) {
    const before = await snapshot();
    for (let attempt = 0; attempt < 3; attempt++) {
      let pending: ReturnType<typeof settle> | undefined;
      let committed = false;
      try {
        await a.query('BEGIN ISOLATION LEVEL READ COMMITTED');
        await b.query('BEGIN ISOLATION LEVEL READ COMMITTED');
        await a.query(...first);
        if (beforeSecond) await b.query(...beforeSecond);
        pending = settle(b.query(...second));
        await waitForHouseholdLock();
        await a.query('COMMIT');
        committed = true;
        const result = await pending;
        if (!result.ok && (result.error as { code?: string }).code === '40P01') throw result.error;
        if (prefix) {
          expect(result).toMatchObject({ ok: false, error: treeError(prefix) });
          await expect(b.query('SELECT 1')).rejects.toMatchObject({ code: '25P02' });
          await b.query('ROLLBACK');
        } else {
          expect(result).toEqual({ ok: true });
          await b.query('COMMIT');
        }
        return;
      } catch (error) {
        await observer.query('SELECT pg_cancel_backend($1)', [bPid]);
        const result = await pending;
        await a.query('ROLLBACK');
        await b.query('ROLLBACK');
        const deadlock =
          (error as { code?: string }).code === '40P01' ||
          (result && !result.ok && (result.error as { code?: string }).code === '40P01');
        // A committed transaction cannot be undone for a retry. Never treat an
        // arbitrary error, timeout, or deadlock as successful cycle prevention.
        if (!deadlock || committed) throw error;
        expect(await snapshot()).toEqual(before);
        if (attempt === 2) throw error;
      }
    }
  }

  async function expectForest(table: 'items' | 'catalog_nodes') {
    const rows = (
      await observer.query(`SELECT id,parent_id FROM ${table} WHERE household_id=$1`, [household])
    ).rows;
    const parents = new Map<string, string | null>(rows.map((row) => [row.id, row.parent_id]));
    for (const row of rows) {
      const visited = new Set<string>();
      let cursor: string | null = row.id;
      while (cursor !== null) {
        expect(visited.has(cursor)).toBe(false);
        expect(parents.has(cursor)).toBe(true);
        visited.add(cursor);
        cursor = parents.get(cursor)!;
      }
    }
  }

  it('TREE01: opposite item moves wait on the household lock and reject the newly committed cycle', async () => {
    expect((await a.query('SHOW transaction_isolation')).rows[0].transaction_isolation).toBe(
      'read committed',
    );
    await race(move('items', itemA, itemB), move('items', itemB, itemA), 'TREE_ITEM_CYCLE');
    expect(
      (await observer.query('SELECT parent_id FROM items WHERE id=$1', [itemA])).rows[0].parent_id,
    ).toBe(itemB);
    expect(
      (await observer.query('SELECT parent_id FROM items WHERE id=$1', [itemB])).rows[0].parent_id,
    ).toBeNull();
    await expectForest('items');
  });
  it('TREE02: opposite GROUP moves cannot commit a cycle', async () => {
    await race(
      move('catalog_nodes', groupA, groupB),
      move('catalog_nodes', groupB, groupA),
      'TREE_CATALOG_CYCLE',
    );
    expect(
      (await observer.query('SELECT parent_id FROM catalog_nodes WHERE id=$1', [groupA])).rows[0]
        .parent_id,
    ).toBe(groupB);
    expect(
      (await observer.query('SELECT parent_id FROM catalog_nodes WHERE id=$1', [groupB])).rows[0]
        .parent_id,
    ).toBeNull();
    await expectForest('catalog_nodes');
  });
  it.each([false, true])(
    'TREE03: move versus capability removal (removal first: %s)',
    async (removalFirst) => {
      const removal: Statement = ["UPDATE items SET attributes='[]'::jsonb WHERE id=$1", [itemB]];
      const moving = move('items', itemA, itemB);
      await race(
        removalFirst ? removal : moving,
        removalFirst ? moving : removal,
        removalFirst ? 'TREE_ITEM_PARENT' : 'TREE_CONTAINER_IN_USE',
      );
      const rows = (
        await observer.query('SELECT id,parent_id,attributes FROM items WHERE id=ANY($1)', [
          [itemA, itemB],
        ])
      ).rows;
      expect(rows.find((row) => row.id === itemA).parent_id).toBe(removalFirst ? null : itemB);
      expect(rows.find((row) => row.id === itemB).attributes).toEqual(
        removalFirst ? [] : JSON.parse(capable),
      );
      await expectForest('items');
    },
  );
  it('TREE05: rejected concurrent transaction rolls back its earlier name update and releases the lock', async () => {
    await race(move('items', itemA, itemB), move('items', itemB, itemA), 'TREE_ITEM_CYCLE', [
      'UPDATE items SET display_name=$2 WHERE id=$1',
      [itemC, 'must roll back'],
    ]);
    expect(
      (await observer.query('SELECT display_name FROM items WHERE id=$1', [itemC])).rows[0]
        .display_name,
    ).toBeNull();
    await b.query('UPDATE items SET parent_id=$2 WHERE id=$1', [itemC, itemB]);
    await expectForest('items');
  });
  it('TREE05: rolling back the first writer lets the waiter commit without a stale edge', async () => {
    await a.query('BEGIN');
    await a.query(...move('items', itemA, itemB));
    await b.query('BEGIN');
    const pending = settle(b.query(...move('items', itemB, itemA)));
    try {
      await waitForHouseholdLock();
      await a.query('ROLLBACK');
      expect(await pending).toEqual({ ok: true });
      await b.query('COMMIT');
    } finally {
      await observer.query('SELECT pg_cancel_backend($1)', [bPid]);
      await a.query('ROLLBACK');
      await pending;
      await b.query('ROLLBACK');
    }
    expect(
      (await observer.query('SELECT parent_id FROM items WHERE id=$1', [itemA])).rows[0].parent_id,
    ).toBeNull();
    expect(
      (await observer.query('SELECT parent_id FROM items WHERE id=$1', [itemB])).rows[0].parent_id,
    ).toBe(itemA);
    await expectForest('items');
  });
  it('TREE06: a valid catalog move and new item-to-SKU reference serialize and both commit', async () => {
    const item = id('item');
    await race(move('catalog_nodes', sku, groupA), [
      'INSERT INTO items(id,household_id,catalog_node_id) VALUES($1,$2,$3)',
      [item, household, sku],
    ]);
    expect(
      (await observer.query('SELECT catalog_node_id FROM items WHERE id=$1', [item])).rows[0]
        .catalog_node_id,
    ).toBe(sku);
    expect(
      (await observer.query('SELECT parent_id FROM catalog_nodes WHERE id=$1', [sku])).rows[0]
        .parent_id,
    ).toBe(groupA);
    await expectForest('catalog_nodes');
  });
  it.each([false, true])(
    'TREE06: SKU kind change versus reference creation (reference first: %s)',
    async (referenceFirst) => {
      const freeSku = id('catalog_node');
      const item = id('item');
      await insertCatalog(a, freeSku, household);
      const change: Statement = [
        "UPDATE catalog_nodes SET kind='GROUP',parent_id=$2 WHERE id=$1",
        [freeSku, groupA],
      ];
      const reference: Statement = [
        'INSERT INTO items(id,household_id,catalog_node_id) VALUES($1,$2,$3)',
        [item, household, freeSku],
      ];
      await race(
        referenceFirst ? reference : change,
        referenceFirst ? change : reference,
        referenceFirst ? 'TREE_SKU_IN_USE' : 'TREE_ITEM_SKU',
      );
      expect(
        (await observer.query('SELECT kind FROM catalog_nodes WHERE id=$1', [freeSku])).rows[0]
          .kind,
      ).toBe(referenceFirst ? 'SKU' : 'GROUP');
      expect((await observer.query('SELECT 1 FROM items WHERE id=$1', [item])).rowCount).toBe(
        referenceFirst ? 1 : 0,
      );
      await expectForest('catalog_nodes');
    },
  );

  it('uses the service lock key even when the holder has performed no tree write', async () => {
    await race(
      ['SELECT pg_advisory_xact_lock(hashtextextended($1,0))', [household]],
      move('items', itemA, itemB),
    );
    await expectForest('items');
  });
  it.each([false, true])(
    'catalog child move versus GROUP-to-SKU conversion (conversion first: %s)',
    async (conversionFirst) => {
      const conversion: Statement = ["UPDATE catalog_nodes SET kind='SKU' WHERE id=$1", [groupA]];
      const moving = move('catalog_nodes', groupB, groupA);
      await race(
        conversionFirst ? conversion : moving,
        conversionFirst ? moving : conversion,
        conversionFirst ? 'TREE_CATALOG_PARENT' : 'TREE_SKU_CHILDREN',
      );
      expect(
        (await observer.query('SELECT kind FROM catalog_nodes WHERE id=$1', [groupA])).rows[0].kind,
      ).toBe(conversionFirst ? 'SKU' : 'GROUP');
      expect(
        (await observer.query('SELECT parent_id FROM catalog_nodes WHERE id=$1', [groupB])).rows[0]
          .parent_id,
      ).toBe(conversionFirst ? null : groupA);
      await expectForest('catalog_nodes');
    },
  );
  it('rejects missing, GROUP and cross-household SKU references on INSERT and UPDATE', async () => {
    for (const catalog of [id('catalog_node'), groupA, malformedSku]) {
      await expect(insertItem(a, id('item'), household, catalog)).rejects.toMatchObject(
        treeError('TREE_ITEM_SKU'),
      );
      await expect(
        a.query('UPDATE items SET catalog_node_id=$2 WHERE id=$1', [itemA, catalog]),
      ).rejects.toMatchObject(treeError('TREE_ITEM_SKU'));
    }
  });
  it('rejects missing, non-container and cross-household item parents on INSERT and UPDATE', async () => {
    await a.query("UPDATE items SET attributes='[]'::jsonb WHERE id=$1", [itemB]);
    for (const parent of [id('item'), itemB, malformedItems[0]]) {
      await expect(insertItem(a, id('item'), household, sku, parent)).rejects.toMatchObject(
        treeError('TREE_ITEM_PARENT'),
      );
      await expect(a.query(...move('items', itemA, parent))).rejects.toMatchObject(
        treeError('TREE_ITEM_PARENT'),
      );
    }
  });
  it.each([
    '[]',
    '[{"template_id":"container","values":{"can_contain":false}}]',
    '[{"template_id":"container","values":{"can_contain":"true"}}]',
    '[{"template_id":"other","values":{"can_contain":true}}]',
  ])('requires the exact container binding and boolean true: %s', async (attributes) => {
    await a.query(...move('items', itemA, itemB));
    await expect(
      a.query('UPDATE items SET attributes=$2::jsonb WHERE id=$1', [itemB, attributes]),
    ).rejects.toMatchObject(treeError('TREE_CONTAINER_IN_USE'));
    await a.query('UPDATE items SET parent_id=NULL WHERE id=$1', [itemA]);
    await a.query('UPDATE items SET attributes=$2::jsonb WHERE id=$1', [itemB, attributes]);
    await expect(a.query(...move('items', itemA, itemB))).rejects.toMatchObject(
      treeError('TREE_ITEM_PARENT'),
    );
  });
  it('rejects missing, SKU and cross-household catalog parents on INSERT and UPDATE', async () => {
    for (const parent of [id('catalog_node'), sku, malformedGroups[0]]) {
      await expect(
        insertCatalog(a, id('catalog_node'), household, 'GROUP', parent),
      ).rejects.toMatchObject(treeError('TREE_CATALOG_PARENT'));
      await expect(a.query(...move('catalog_nodes', groupA, parent))).rejects.toMatchObject(
        treeError('TREE_CATALOG_PARENT'),
      );
    }
  });
  it('rejects self-parents on INSERT and UPDATE for both trees', async () => {
    const item = id('item'),
      group = id('catalog_node');
    await expect(insertItem(a, item, household, sku, item)).rejects.toMatchObject(
      treeError('TREE_ITEM_SELF_PARENT'),
    );
    await expect(a.query(...move('items', itemA, itemA))).rejects.toMatchObject(
      treeError('TREE_ITEM_SELF_PARENT'),
    );
    await expect(insertCatalog(a, group, household, 'GROUP', group)).rejects.toMatchObject(
      treeError('TREE_CATALOG_SELF_PARENT'),
    );
    await expect(a.query(...move('catalog_nodes', groupA, groupA))).rejects.toMatchObject(
      treeError('TREE_CATALOG_SELF_PARENT'),
    );
  });
  it('rejects kind changes that invalidate children or item references, but permits unused conversions', async () => {
    await a.query(...move('catalog_nodes', groupB, groupA));
    await expect(
      a.query("UPDATE catalog_nodes SET kind='SKU' WHERE id=$1", [groupA]),
    ).rejects.toMatchObject(treeError('TREE_SKU_CHILDREN'));
    await expect(
      a.query("UPDATE catalog_nodes SET kind='GROUP' WHERE id=$1", [sku]),
    ).rejects.toMatchObject(treeError('TREE_SKU_IN_USE'));
    await a.query("UPDATE catalog_nodes SET kind='SKU' WHERE id=$1", [groupB]);
    await a.query("UPDATE catalog_nodes SET kind='GROUP' WHERE id=$1", [groupB]);
  });
  it('rejects identity changes even on otherwise unreferenced roots', async () => {
    for (const [table, node, kind] of [
      ['items', itemC, 'item'],
      ['catalog_nodes', groupA, 'catalog_node'],
    ]) {
      await expect(
        a.query(`UPDATE ${table} SET id=$2 WHERE id=$1`, [node, id(kind)]),
      ).rejects.toMatchObject(treeError('TREE_IMMUTABLE_IDENTITY'));
      await expect(
        a.query(`UPDATE ${table} SET household_id=$2 WHERE id=$1`, [node, malformedHousehold]),
      ).rejects.toMatchObject(treeError('TREE_IMMUTABLE_IDENTITY'));
    }
  });
  it('terminates and rejects attachment to pre-existing malformed cycles in both trees', async () => {
    await expect(
      insertItem(a, id('item'), malformedHousehold, malformedSku, malformedItems[0]),
    ).rejects.toMatchObject(treeError('TREE_ITEM_CYCLE'));
    await expect(
      insertCatalog(a, id('catalog_node'), malformedHousehold, 'GROUP', malformedGroups[0]),
    ).rejects.toMatchObject(treeError('TREE_CATALOG_CYCLE'));
    const item = id('item'),
      group = id('catalog_node');
    await insertItem(a, item, malformedHousehold, malformedSku);
    await insertCatalog(a, group, malformedHousehold, 'GROUP');
    await expect(a.query(...move('items', item, malformedItems[0]))).rejects.toMatchObject(
      treeError('TREE_ITEM_CYCLE'),
    );
    await expect(
      a.query(...move('catalog_nodes', group, malformedGroups[0])),
    ).rejects.toMatchObject(treeError('TREE_CATALOG_CYCLE'));
  });
  it('rejects a multi-row opposite-parent statement atomically', async () => {
    for (const [table, left, right, prefix] of [
      ['items', itemA, itemB, 'TREE_ITEM_CYCLE'],
      ['catalog_nodes', groupA, groupB, 'TREE_CATALOG_CYCLE'],
    ]) {
      await expect(
        a.query(
          `UPDATE ${table} SET parent_id=CASE WHEN id=$1 THEN $2 ELSE $1 END WHERE id IN ($1,$2)`,
          [left, right],
        ),
      ).rejects.toMatchObject(treeError(prefix));
      expect(
        (await observer.query(`SELECT parent_id FROM ${table} WHERE id IN ($1,$2)`, [left, right]))
          .rows,
      ).toEqual([{ parent_id: null }, { parent_id: null }]);
    }
  });
  it('name-only changes do not acquire tree locks; contents-only changes preserve container capability', async () => {
    await a.query('BEGIN');
    await a.query('SELECT pg_advisory_xact_lock(hashtextextended($1,0))', [household]);
    await b.query('BEGIN');
    await b.query("UPDATE items SET display_name='renamed' WHERE id=$1", [itemA]);
    await b.query("UPDATE catalog_nodes SET name='renamed' WHERE id=$1", [groupA]);
    expect(
      (await observer.query("SELECT 1 FROM pg_locks WHERE pid=$1 AND locktype='advisory'", [bPid]))
        .rowCount,
    ).toBe(0);
    await b.query('COMMIT');
    await a.query('COMMIT');
    await a.query(...move('items', itemA, itemB));
    await a.query(
      `UPDATE items SET attributes=attributes || '[{"template_id":"contents","values":{"remaining":{"value":"1","unit":"count"}}}]'::jsonb WHERE id=$1`,
      [itemB],
    );
    expect(
      (
        await a.query('SELECT attributes @> $2::jsonb AS capable FROM items WHERE id=$1', [
          itemB,
          capable,
        ])
      ).rows[0].capable,
    ).toBe(true);
    // Unrelated bindings do not recursively revalidate untouched legacy edges.
    await a.query(
      `UPDATE items SET attributes=attributes || '[{"template_id":"contents","values":{"remaining":{"value":"1","unit":"count"}}}]'::jsonb WHERE id=$1`,
      [malformedItems[0]],
    );
  });
});

it.todo(
  'TREE04: service integrator must reject non-READ COMMITTED writes with UNSUPPORTED_WRITE_ISOLATION after acquiring the household lock (read-only REPEATABLE READ remains allowed)',
);
