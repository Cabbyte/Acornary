import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { randomUUID } from 'node:crypto';
import { Client, StreamableHTTPClientTransport } from '@modelcontextprotocol/client';
import { buildApp } from '../apps/server/src/app.js';
import { pool, transaction } from '../apps/server/src/db.js';
import { createHousehold } from '../apps/server/src/initialize.js';
import { approvedExecute } from './catalog-helpers.js';
import { type Context } from '../apps/server/src/service.js';
import { schemas, reads, type Operation } from '../packages/contracts/src/index.js';
import { pluginEnvelopeSchema, pluginWriteResultSchema } from '../packages/contracts/src/plugin.js';

const token = '8'.repeat(64);
const attr = (template_id: string, values: unknown) => ({
  template_id,
  template_version: 1,
  values,
});
let app: Awaited<ReturnType<typeof buildApp>>, client: Client, scope: string, sku: string;
const call = async (name: string, args: Record<string, unknown> = {}) => {
  const result = await client.callTool({ name, arguments: args });
  expect(result.isError, JSON.stringify(result)).not.toBe(true);
  return result.structuredContent as any;
};
const write = async (operation: Operation, input: Record<string, unknown>) => {
  const result = await call('apply_inventory_command', {
    expected_scope: scope,
    operation,
    input: { idempotency_key: randomUUID(), ...input },
  });
  expect(pluginWriteResultSchema.parse(result)).toEqual(result);
  expect(result.summary).toBeTypeOf('string');
  return result;
};
const create = async (attributes: unknown[] = []) => {
  const result = await write('create_items', {
    catalog_node_id: sku,
    count: 1,
    initial_attributes: attributes,
  });
  return result.affected_objects[0].id as string;
};
const change = async (operation: Operation, item_id: string, input: Record<string, unknown>) => {
  const item = await call('get_item', { item_id });
  return write(operation, { item_id, expected_revisions: { [item_id]: item.revision }, ...input });
};

describe('MCP v2 transport and plugin write receipts', () => {
  beforeAll(async () => {
    if (!process.env.DATABASE_URL?.includes('acornary_test'))
      throw Error('Isolated test database required');
    const ctx: Context = {
      ...(await transaction((c) => createHousehold(c, 'MCP v2'))),
      source: 'TEST',
    };
    sku = (
      await approvedExecute(ctx, 'create_catalog_node', {
        kind: 'SKU',
        name: 'MCP receipt item',
        idempotency_key: randomUUID(),
      })
    ).affected_objects[0].id;
    app = await buildApp(ctx, token, false, { mode: 'local' });
    const address = await app.listen({ host: '127.0.0.1', port: 0 });
    client = new Client({ name: 'normal-mcp-client', version: '2' });
    // Normal MCP negotiation and authentication; no X-Acornary-Protocol header.
    await client.connect(
      new StreamableHTTPClientTransport(new URL(`${address}/mcp`), {
        requestInit: { headers: { Authorization: `Bearer ${token}` } },
      }),
    );
    const opened = await client.callTool({ name: 'open_inventory', arguments: {} });
    const envelope = pluginEnvelopeSchema.parse(opened._meta?.['acornary/view']);
    expect(envelope.version).toBe(2);
    expect(envelope.protocol).toBe(2);
    expect(envelope.snapshot.protocol).toBe(2);
    expect(envelope.snapshot).not.toHaveProperty('notes');
    scope = envelope.session.cache_key;
  });
  afterAll(async () => {
    await client?.close();
    await app?.close();
    await pool.end();
  });

  it('serves authenticated tools/call and negotiation without the HTTP business header', async () => {
    expect((await call('get_connection_context')).protocol).toEqual({ current: 2, min: 2 });
    expect((await call('query_items')).data).toEqual([]);
    const view = await client.callTool({ name: 'get_inventory_view', arguments: {} });
    expect(pluginEnvelopeSchema.parse(view._meta?.['acornary/view']).version).toBe(2);
    const tools = (await client.listTools()).tools;
    for (const name of Object.keys(schemas) as Operation[]) {
      const tool = tools.find((tool) => tool.name === name)!;
      expect(tool, name).toBeDefined();
      expect(tool.description, name).toBeTruthy();
      expect(tool.annotations).toMatchObject({
        readOnlyHint: reads.has(name),
        destructiveHint: !reads.has(name),
        idempotentHint: true,
      });
    }
    expect(tools.find((t) => t.name === 'open_inventory')?._meta?.ui).toMatchObject({
      resourceUri: expect.stringMatching(/inventory-v2-[a-f0-9]{16}\.html$/),
    });
    const unauthenticated = await app.inject({
      method: 'POST',
      url: '/mcp',
      payload: {
        jsonrpc: '2.0',
        id: 1,
        method: 'tools/call',
        params: { name: 'query_items', arguments: {} },
      },
    });
    expect(unauthenticated.statusCode).toBe(401);
    for (const url of [
      '/api/read/query_items',
      '/api/write/create_items',
      '/api/ui/snapshot',
      '/api/sync/state',
      '/api/attachments/missing',
      '/api/debug',
    ]) {
      const response = await app.inject({ method: 'GET', url });
      expect(response.statusCode, url).toBe(409);
      expect(response.json().error.code).toBe('PROTOCOL_VERSION_UNSUPPORTED');
    }
    expect((await app.inject({ url: '/api/context' })).statusCode).toBe(200);
  });

  it('validates create/edit and target-based note results without embedding bodies in the view', async () => {
    const item_id = await create();
    const added = await write('add_note', {
      target: { kind: 'ITEM', id: item_id },
      body: 'Full note text',
      expected_revisions: { [item_id]: 1 },
    });
    expect(added.note.target).toEqual({ kind: 'ITEM', id: item_id });
    expect(added.note).not.toHaveProperty('body');
    const detail = await call('get_item', { item_id });
    expect(detail.id).toBe(item_id);
    expect(detail).not.toHaveProperty('item');
    expect(detail.notes[0]).not.toHaveProperty('body');
    expect((await call('get_note', { note_id: added.note_id })).body).toBe('Full note text');
    await write('update_note', {
      target: { kind: 'ITEM', id: item_id },
      note_id: added.note_id,
      body: 'Updated note',
      expected_revisions: { [item_id]: 2 },
    });
    const edited = await change('edit_item', item_id, {
      display_name: 'Edited',
      note: { note_id: added.note_id, body: 'Atomic edit' },
    });
    expect(edited.note_id).toBe(added.note_id);
    await write('archive_note', {
      target: { kind: 'ITEM', id: item_id },
      note_id: added.note_id,
      archived: true,
      expected_revisions: { [item_id]: 4 },
    });
    const legacy = await client.callTool({
      name: 'apply_inventory_command',
      arguments: {
        expected_scope: scope,
        operation: 'add_note',
        input: {
          item_id,
          body: 'Legacy',
          expected_revisions: { [item_id]: 5 },
          idempotency_key: randomUUID(),
        },
      },
    });
    expect(legacy.isError).toBe(true);
  });

  it('validates void/dispose/split results including child revisions and source links', async () => {
    await change('void_item', await create(), { reason: 'Duplicate' });
    await change('dispose_item', await create(), {
      disposition: { kind: 'DISCARD', date: '2026-11-01' },
    });
    const source_item_id = await create([
      attr('contents', { remaining: { value: '2', unit: 'count' } }),
    ]);
    const result = await write('split_item', {
      source_item_id,
      target_catalog_node_id: sku,
      count: 2,
      child_attributes: [attr('contents', { remaining: { value: '1', unit: 'count' } })],
      expected_revisions: { [source_item_id]: 1 },
    });
    expect(result.children).toHaveLength(2);
    expect(result.children[0].revision).toBe(1);
    expect(result.split.source_item_id).toBe(source_item_id);
    expect(result.split.child_item_ids).toEqual(
      expect.arrayContaining(result.children.map((c: any) => c.item_id)),
    );
  });

  it('validates all deadline receipts and full intake receipts', async () => {
    const item_id = await create();
    await change('add_deadline', item_id, { entry: { kind: 'SERVICE_DUE', due_on: '2026-11-01' } });
    const detail = await call('get_item', { item_id });
    const entry_id = detail.attributes.find((a: any) => a.template_id === 'deadline').values
      .entries[0].id;
    await change('update_deadline', item_id, { entry_id, patch: { due_on: '2026-11-02' } });
    await change('complete_deadline', item_id, { entry_id, completed_on: '2026-11-02' });
    await change('remove_deadline', item_id, { entry_id });
    const context = await call('get_intake_context', { catalog_node_ids: [sku] });
    const result = await write('commit_intake', {
      policy_revision: context.policy_revision,
      expected_revisions: context.expected_revisions,
      lines: [{ product: { catalog_node_id: sku }, instances: [{ count: 1 }] }],
    });
    expect(result.receipt.item_count).toBe(1);
    expect(result.receipt.items).toHaveLength(1);
  });

  it('rejects attachment upload tools through both model and app channels', async () => {
    for (const operation of ['create_attachment_upload', 'complete_attachment_upload']) {
      for (const [name, args] of [
        [operation, {}],
        ['apply_inventory_command', { expected_scope: scope, operation, input: {} }],
      ] as const) {
        const result = await client.callTool({ name, arguments: args });
        expect(result.isError).toBe(true);
        expect(result.structuredContent).toMatchObject({
          error: { code: 'ATTACHMENT_TRANSPORT_UNSUPPORTED', recovery: 'USE_WEB' },
        });
      }
    }
  });
});
