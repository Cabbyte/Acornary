import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { randomUUID } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import { z } from 'zod';
import { Client as McpClient, StreamableHTTPClientTransport } from '@modelcontextprotocol/client';
import { schemas, templateDefinition, validateValues } from '../packages/contracts/src/index.js';
import { execute, type Context } from '../apps/server/src/service.js';
import { initialize, createHousehold } from '../apps/server/src/initialize.js';
import { pool, query, transaction } from '../apps/server/src/db.js';
import { buildApp } from '../apps/server/src/app.js';
import { newTrace, traces, traceMetadata } from '../apps/server/src/telemetry.js';

let ctx: Context;
const key = () => randomUUID();
const run = (name: keyof typeof schemas, input: any) => execute(ctx, name, input);
const write = (name: keyof typeof schemas, input: any) =>
  run(name, { idempotency_key: key(), ...input });
const attribute = (template_id: string, values: any, template_version = 1) => ({
  template_id,
  template_version,
  values,
});
const sku = async (name = '梅花肉', initial_attributes: any[] = []) =>
  (await write('create_catalog_node', { kind: 'SKU', name, initial_attributes }))
    .affected_objects[0].id;
const item = async (
  catalog_node_id: string,
  initial_attributes: any[] = [],
  parent_id: string | null = null,
) =>
  (await write('create_items', { catalog_node_id, count: 1, parent_id, initial_attributes }))
    .affected_objects[0].id;
const weights = ['425', '495', '245', '520'];
const entries = (catalog_node_id: string, parent_id: string | null = null) =>
  weights.map((value, i) => ({
    client_ref: `pack-${i + 1}`,
    catalog_node_id,
    parent_id,
    initial_attributes: [
      attribute('contents', { remaining: { value, unit: 'g' } }),
      attribute('lifecycle', {
        acquisition: { acquired_on: '2026-10-11' },
        expiry: { date: '2027-10-11', date_kind: 'ESTIMATED' },
      }),
    ],
  }));
beforeAll(async () => {
  if (!process.env.DATABASE_URL?.includes('acornary_test'))
    throw new Error('Requires isolated test database');
  await initialize();
});
beforeEach(async () => {
  ctx = { ...(await transaction((c) => createHousehold(c, '语音验收家庭'))), source: 'TEST' };
});
afterAll(() => pool.end());

describe('voice intake contracts and atomic writes', () => {
  it('requires revisions for edits but preserves creation normalization', async () => {
    for (const name of [
      'move_items',
      'bind_attributes',
      'upgrade_attributes',
      'update_items_lifecycle',
    ] as const)
      expect(z.toJSONSchema(schemas[name], { io: 'input' }).required).toContain(
        'expected_revisions',
      );
    expect(z.toJSONSchema(schemas.create_items, { io: 'input' }).required).not.toContain(
      'expected_revisions',
    );
    const id = await item(await sku());
    await expect(write('move_item', { item_id: id, parent_id: null })).rejects.toMatchObject({
      code: 'MISSING_EXPECTED_REVISION',
    });
    await expect(
      write('move_items', { item_ids: [id], parent_id: null, expected_revisions: {} }),
    ).rejects.toMatchObject({ code: 'MISSING_EXPECTED_REVISION', details: { missing_ids: [id] } });
    await expect(
      write('move_item', { item_id: id, parent_id: null, expected_revisions: { [id]: 99 } }),
    ).rejects.toMatchObject({
      code: 'REVISION_CONFLICT',
      details: { expected_revision: 99, current_revision: 1 },
    });
    expect((await run('get_item', { item_id: id })).revision).toBe(1);
  });
  it('creates four distinct meat packs with one operation and stable concurrent replay', async () => {
    const container = await sku('容器');
    const room = await item(container, [attribute('container', { can_contain: true })]);
    const freezer = await item(container, [attribute('container', { can_contain: true })], room);
    const catalog_node_id = await sku();
    const input = { idempotency_key: key(), items: entries(catalog_node_id, freezer) };
    const [result, replay] = await Promise.all([
      run('create_items_batch', input),
      run('create_items_batch', input),
    ]);
    expect(replay).toEqual(result);
    expect(result.created_items).toHaveLength(4);
    expect(new Set(result.created_items.map((r: any) => r.item_id)).size).toBe(4);
    const items = await run('query_items', { catalog_node_ids: [catalog_node_id] });
    expect(items.content_totals.by_unit.g.value).toBe('1685');
    for (const [index, created] of result.created_items.entries()) {
      const actual = await run('get_item', { item_id: created.item_id, include_path: true });
      expect(actual.path_ids).toEqual([room, freezer, created.item_id]);
      expect(actual.attributes).toEqual(
        expect.arrayContaining(entries(catalog_node_id)[index].initial_attributes),
      );
      expect(actual.revision).toBe(1);
    }
    expect((await run('get_history', { operation_id: result.operation_id })).data).toHaveLength(4);
    await expect(
      run('create_items_batch', { ...input, items: input.items.slice(0, 3) }),
    ).rejects.toMatchObject({ code: 'IDEMPOTENCY_CONFLICT' });
  });
  it('rolls back an invalid pack and identifies its original index/ref', async () => {
    const catalog_node_id = await sku();
    const input = { idempotency_key: key(), items: entries(catalog_node_id) };
    input.items[2].initial_attributes[0].values.remaining.value = '-1';
    await expect(run('create_items_batch', input)).rejects.toMatchObject({
      code: 'ATTRIBUTE_VALIDATION_FAILED',
      details: { item_index: 2, client_ref: 'pack-3' },
    });
    expect((await run('query_items', { catalog_node_ids: [catalog_node_id] })).matching_count).toBe(
      0,
    );
    expect(
      (
        await query(pool, 'SELECT * FROM operations WHERE household_id=$1 AND idempotency_key=$2', [
          ctx.household_id,
          input.idempotency_key,
        ])
      ).rows,
    ).toHaveLength(0);
    await expect(
      write('create_items_batch', {
        items: [entries(catalog_node_id)[0], entries(catalog_node_id)[0]],
      }),
    ).rejects.toMatchObject({ details: { item_index: 1, client_ref: 'pack-1' } });
    expect((await run('query_items', { catalog_node_ids: [catalog_node_id] })).matching_count).toBe(
      0,
    );
    const foreign = await transaction((c) => createHousehold(c));
    const foreignItem = (
      await execute({ ...foreign, source: 'TEST' }, 'create_items', {
        catalog_node_id: foreign.container_catalog_id,
        count: 1,
        idempotency_key: key(),
      })
    ).affected_objects[0].id;
    await expect(
      write('create_items_batch', { items: entries(catalog_node_id, foreignItem) }),
    ).rejects.toMatchObject({ code: 'NOT_FOUND', details: { item_index: 0 } });
  });
  it('updates lifecycle atomically, retains untouched values and rejects stale revisions', async () => {
    const created = await write('create_items_batch', { items: entries(await sku()) });
    const ids = created.created_items.map((i: any) => i.item_id);
    const input = {
      idempotency_key: key(),
      expected_revisions: Object.fromEntries(ids.map((id: string) => [id, 1])),
      items: ids.map((item_id: string) => ({
        item_id,
        template_version: 1,
        set: { 'expiry.date': '2027-09-11' },
      })),
    };
    await expect(
      run('update_items_lifecycle', {
        ...input,
        expected_revisions: { ...input.expected_revisions, [ids[3]]: 2 },
      }),
    ).rejects.toMatchObject({ code: 'REVISION_CONFLICT', details: { item_index: 3 } });
    expect((await run('get_item', { item_id: ids[0] })).revision).toBe(1);
    const result = await run('update_items_lifecycle', input);
    expect(result.affected_objects).toHaveLength(4);
    expect(await run('update_items_lifecycle', input)).toEqual(result);
    const actual = await run('get_item', { item_id: ids[0] });
    expect(actual.revision).toBe(2);
    expect(actual.attributes.find((a: any) => a.template_id === 'lifecycle').values).toEqual({
      acquisition: { acquired_on: '2026-10-11' },
      expiry: { date: '2027-09-11', date_kind: 'ESTIMATED' },
    });
  });
  it('upgrades product explicitly without adding stock or deriving dates, preserving old replays', async () => {
    const catalog_node_id = await sku('盒马5.0蛋白牛奶 750mL', [
      attribute('product', {
        specification: '750mL；保质期15天',
        storage: { requirement: 'REFRIGERATED' },
      }),
    ]);
    const edit = {
      idempotency_key: key(),
      target: { kind: 'CATALOG_NODE', id: catalog_node_id },
      template_id: 'product',
      template_version: 1,
      expected_revisions: { [catalog_node_id]: 1 },
      set: { brand: '盒马' },
    };
    const priorResult = await run('update_attributes', edit);
    const prior = await run('get_catalog_node', { catalog_node_id });
    const values = { ...prior.attributes[0].values, shelf_life_days: 15 };
    await expect(
      write('update_attributes', {
        ...edit,
        idempotency_key: key(),
        expected_revisions: { [catalog_node_id]: 2 },
        template_version: 2,
        set: { shelf_life_days: 15 },
      }),
    ).rejects.toMatchObject({ code: 'ATTRIBUTE_VALIDATION_FAILED' });
    const upgraded = await write('upgrade_attributes', {
      target: edit.target,
      template_id: 'product',
      template_version: 2,
      expected_revisions: { [catalog_node_id]: 2 },
      values,
    });
    const actual = await run('get_catalog_node', { catalog_node_id });
    expect(actual.attributes).toEqual([attribute('product', values, 2)]);
    expect(actual.revision).toBe(3);
    expect(await run('update_attributes', edit)).toEqual(priorResult);
    expect((await run('query_items', { catalog_node_ids: [catalog_node_id] })).matching_count).toBe(
      0,
    );
    const history = (await run('get_history', { operation_id: upgraded.operation_id })).data[0];
    expect(history.event_type).toBe('ATTRIBUTE_UPGRADE');
    expect(
      history.changes.find((c: any) => c.path === 'attributes.product.$binding').after
        .template_version,
    ).toBe(2);
    expect(
      (await run('get_attribute_template', { template_id: 'product', template_version: 1 })).schema
        .properties,
    ).not.toHaveProperty('shelf_life_days');
    expect(
      (await run('get_attribute_template', { template_id: 'product', template_version: 2 })).schema
        .properties,
    ).toHaveProperty('shelf_life_days');
    expect(() => validateValues('product', { shelf_life_days: 15 })).toThrow();
    expect(
      (
        await run('query_catalog_nodes', {
          attribute_filters: [
            { template_id: 'product', path: 'shelf_life_days', op: 'eq', value: 15 },
          ],
        })
      ).matching_count,
    ).toBe(1);
  });
  it('appends v2 to a pre-upgrade household without changing records, events or fingerprints', async () => {
    ctx = { household_id: 'household_' + key(), actor_id: 'actor_' + key(), source: 'TEST' };
    await query(
      pool,
      "INSERT INTO households(id,name,timezone) VALUES($1,'legacy','Asia/Shanghai')",
      [ctx.household_id],
    );
    await query(pool, "INSERT INTO actors(id,household_id,name) VALUES($1,$2,'legacy')", [
      ctx.actor_id,
      ctx.household_id,
    ]);
    await query(
      pool,
      "INSERT INTO attribute_templates(household_id,id,version,target_kind,definition) VALUES($1,'product',1,'CATALOG_NODE',$2::jsonb)",
      [ctx.household_id, JSON.stringify(templateDefinition('product', 1))],
    );
    const id = await sku('legacy', [attribute('product', { brand: 'legacy' })]);
    const snapshot = async () => {
      const result: Record<string, unknown> = {};
      for (const table of ['catalog_nodes', 'items', 'events', 'operations', 'attribute_templates'])
        result[table] = (
          await query(
            pool,
            `SELECT to_jsonb(t) AS data FROM ${table} t WHERE household_id=$1${table === 'attribute_templates' ? ' AND version=1' : ''}`,
            [ctx.household_id],
          )
        ).rows
          .map((row) => JSON.stringify(row.data))
          .sort();
      return result;
    };
    const before = await snapshot();
    const sql = await readFile('migrations/007_product_v2.sql', 'utf8');
    await pool.query(sql);
    await pool.query(sql);
    expect(await snapshot()).toEqual(before);
    expect(
      (
        await query(
          pool,
          "SELECT definition FROM attribute_templates WHERE household_id=$1 AND id='product' AND version=2",
          [ctx.household_id],
        )
      ).rows[0].definition,
    ).toEqual(templateDefinition('product', 2));
    expect(
      (await run('get_catalog_node', { catalog_node_id: id })).attributes[0].template_version,
    ).toBe(1);
    await expect(
      query(pool, "UPDATE attribute_templates SET definition='{}' WHERE household_id=$1", [
        ctx.household_id,
      ]),
    ).rejects.toThrow();
  });
  it('supports a compatibility rollout without silently upgrading bindings', async () => {
    const v2 = await sku('existing v2', [attribute('product', { shelf_life_days: 15 }, 2)]);
    const v1 = await sku('existing v1', [attribute('product', { brand: 'legacy' })]);
    const before = process.env.ACORNARY_PRODUCT_V2_WRITES;
    process.env.ACORNARY_PRODUCT_V2_WRITES = '0';
    try {
      expect(
        (await run('get_catalog_node', { catalog_node_id: v2 })).attributes[0].template_version,
      ).toBe(2);
      await expect(
        sku('new v2', [attribute('product', { shelf_life_days: 15 }, 2)]),
      ).rejects.toMatchObject({ code: 'ATTRIBUTE_VALIDATION_FAILED' });
      await expect(
        write('upgrade_attributes', {
          target: { kind: 'CATALOG_NODE', id: v1 },
          template_id: 'product',
          template_version: 2,
          expected_revisions: { [v1]: 1 },
          values: { brand: 'legacy', shelf_life_days: 15 },
        }),
      ).rejects.toMatchObject({ code: 'ATTRIBUTE_VALIDATION_FAILED' });
      await write('update_attributes', {
        target: { kind: 'CATALOG_NODE', id: v2 },
        template_id: 'product',
        template_version: 2,
        expected_revisions: { [v2]: 1 },
        set: { shelf_life_days: 16 },
      });
      expect((await run('get_catalog_node', { catalog_node_id: v1 })).revision).toBe(1);
    } finally {
      if (before === undefined) delete process.env.ACORNARY_PRODUCT_V2_WRITES;
      else process.env.ACORNARY_PRODUCT_V2_WRITES = before;
    }
  });
  it('keeps per-attempt tracing outside idempotent business results', async () => {
    const input = { idempotency_key: key(), items: entries(await sku()) };
    const one = newTrace(),
      two = newTrace();
    const a = await traces.run(one, () => run('create_items_batch', input));
    const b = await traces.run(two, () => run('create_items_batch', input));
    expect(a).toEqual(b);
    expect(a).not.toHaveProperty('request_id');
    expect(one.request_id).not.toBe(two.request_id);
    expect(traceMetadata(two)).toMatchObject({
      idempotency_replay: true,
      operation_id: a.operation_id,
      outcome: 'SUCCESS',
    });
    for (const phase of ['db_ms', 'pool_wait_ms', 'lock_wait_ms', 'business_ms'] as const)
      expect(one.phases[phase]).toBeGreaterThanOrEqual(0);
  });
  it('exposes strict discovery and structured missing/conflict errors through actual MCP and HTTP', async () => {
    const id = await item(await sku());
    const token = 'd'.repeat(64),
      app = await buildApp(ctx, token, false);
    const address = await app.listen({ host: '127.0.0.1', port: 0 });
    const client = new McpClient({ name: 'intake-test', version: '1' });
    try {
      await client.connect(
        new StreamableHTTPClientTransport(new URL(`${address}/mcp`), {
          requestInit: { headers: { Authorization: `Bearer ${token}` } },
        }),
      );
      const tool = (await client.listTools()).tools.find((t) => t.name === 'move_items')!;
      expect(tool.inputSchema.required).toContain('expected_revisions');
      for (const [extra, code] of [
        [{}, 'MISSING_EXPECTED_REVISION'],
        [{ expected_revisions: {} }, 'MISSING_EXPECTED_REVISION'],
        [{ expected_revisions: { [id]: 9 } }, 'REVISION_CONFLICT'],
      ] as const) {
        const input = { item_id: id, parent_id: null, idempotency_key: key(), ...extra };
        const response = await client.callTool({ name: 'move_item', arguments: input });
        expect(response.isError).toBe(true);
        const error = (response.structuredContent as any).error;
        expect(error.code).toBe(code);
        expect(error.request_id).toBeTruthy();
        expect(JSON.parse((response.content as any)[0].text)).toEqual(response.structuredContent);
        expect((response._meta?.['acornary/trace'] as any).request_id).toBe(error.request_id);
        const http = await app.inject({
          method: 'POST',
          url: '/api/write/move_item',
          headers: { host: 'localhost', origin: 'http://localhost', 'x-acornary-request': 'web' },
          payload: input,
        });
        expect(http.statusCode).toBe(code === 'REVISION_CONFLICT' ? 409 : 400);
        expect(http.json().error.code).toBe(code);
        expect(http.json().error.request_id).toBe(http.headers['x-request-id']);
      }
      const invalid = await client.callTool({
        name: 'move_item',
        arguments: {
          item_id: id,
          parent_id: 42,
          expected_revisions: { [id]: 1 },
          idempotency_key: key(),
        },
      });
      expect(invalid.structuredContent).toMatchObject({
        error: { code: 'ATTRIBUTE_VALIDATION_FAILED', recovery: 'FIX_REQUEST' },
      });
      const view = await client.callTool({ name: 'open_inventory', arguments: {} });
      expect(view._meta?.['acornary/trace']).toMatchObject({
        tool: 'open_inventory',
        outcome: 'SUCCESS',
      });
      const scope = (view._meta?.['acornary/view'] as any).session.cache_key;
      const ui = await client.callTool({
        name: 'apply_inventory_command',
        arguments: {
          expected_scope: scope,
          operation: 'move_item',
          input: { item_id: id, parent_id: null, idempotency_key: key() },
        },
      });
      expect((ui.structuredContent as any).error.code).toBe('MISSING_EXPECTED_REVISION');
      const context = await client.callTool({ name: 'get_connection_context', arguments: {} });
      expect(context.structuredContent).toMatchObject({
        mode: 'local',
        household: { id: ctx.household_id, name: '语音验收家庭', timezone: 'Asia/Shanghai' },
        actor: { id: ctx.actor_id },
        scopes: ['inventory:read', 'inventory:write'],
      });
    } finally {
      await client.close();
      await app.close();
    }
  });
});
