import { beforeAll, beforeEach, afterAll, expect, it } from 'vitest';
import { randomUUID } from 'node:crypto';
import { initialize } from '../apps/server/src/initialize.js';
import { execute, type Context } from '../apps/server/src/service.js';
import { reviewCatalogProposal, confirmCatalogProposal } from '../apps/server/src/intake.js';
import { pool, query } from '../apps/server/src/db.js';
import { approvedExecute, approvedInput } from './catalog-helpers.js';
import { buildApp } from '../apps/server/src/app.js';
import { Client as McpClient, StreamableHTTPClientTransport } from '@modelcontextprotocol/client';
let ctx: Context, branch: string, sku: string, room: string, fridge: string;
const key = () => randomUUID();
const attr = (template_id: string, values: any) => ({ template_id, template_version: 1, values });
const write = (name: any, input: any) => execute(ctx, name, { idempotency_key: key(), ...input });
const approved = (name: any, input: any) =>
  approvedExecute(ctx, name, { idempotency_key: key(), ...input });
const context = (ids = [branch], locations: string[] = []) =>
  execute(ctx, 'get_intake_context', { catalog_node_ids: ids, location_ids: locations });
const rule = (extra = {}) => ({
  branch_id: branch,
  meaning: '食用食品',
  boundaries: '食品；不含餐具和位置',
  subdivision_basis: '食品类型',
  allow_direct_products: true,
  allow_new_groups: true,
  max_new_depth: 2,
  naming_guidance: '具体食物类型，不用重量或位置',
  ...extra,
});
async function proposalApproval(proposal: any, identity = ctx) {
  const result = await execute(identity, 'propose_catalog_change', {
    idempotency_key: key(),
    proposal,
  });
  const review = await reviewCatalogProposal(identity, 'test-ui', {
    proposal_id: result.proposal_id,
  });
  const approval = await confirmCatalogProposal(identity, 'test-ui', {
    proposal_id: result.proposal_id,
    challenge: review.challenge,
  });
  return { ...approval, review, proposal_id: result.proposal_id };
}
async function installRule(extra = {}) {
  const p = await context([branch, sku]);
  return proposalApproval({
    kind: 'policy',
    policy_revision: p.policy_revision,
    expected_revisions: p.expected_revisions,
    rule: rule(extra),
    reason: '确认食品分支',
  });
}
async function batch(product: any = { catalog_node_id: sku }, extra: any = {}) {
  const p = await context([branch, sku], [room, fridge]);
  return {
    idempotency_key: key(),
    policy_revision: p.policy_revision,
    expected_revisions: p.expected_revisions,
    lines: [{ product, instances: [{ count: 1 }] }],
    ...extra,
  };
}
const newProduct = (name = '鸡胸肉', extra = {}) => ({
  name,
  parent_id: branch,
  classification_reason: '食品分支允许直接挂食品',
  initial_attributes: [attr('product', { brand: '农场甲', specification: '散装原切' })],
  ...extra,
});
beforeAll(async () => {
  if (!process.env.DATABASE_URL?.includes('acornary_test'))
    throw new Error('Disposable database required');
  await initialize();
});
beforeEach(async () => {
  const source = (await query(pool, "SELECT * FROM installations WHERE slot='local'")).rows[0];
  ctx = { household_id: 'household_' + key(), actor_id: 'actor_' + key(), source: 'TEST' };
  await query(
    pool,
    "INSERT INTO households(id,name,timezone) VALUES($1,'intake test','Asia/Shanghai')",
    [ctx.household_id],
  );
  await query(pool, "INSERT INTO actors(id,household_id,name) VALUES($1,$2,'Tester')", [
    ctx.actor_id,
    ctx.household_id,
  ]);
  await query(
    pool,
    'INSERT INTO attribute_templates SELECT $1,id,version,target_kind,definition,created_at FROM attribute_templates WHERE household_id=$2',
    [ctx.household_id, source.household_id],
  );
  branch = (await approved('create_catalog_node', { kind: 'GROUP', name: '食品' }))
    .affected_objects[0].id;
  sku = (
    await approved('create_catalog_node', {
      kind: 'SKU',
      name: '鲜奶',
      parent_id: branch,
      initial_attributes: [attr('product', { brand: '农场甲', specification: '1L' })],
    })
  ).affected_objects[0].id;
  const container = (await approved('create_catalog_node', { kind: 'SKU', name: '容器' }))
    .affected_objects[0].id;
  room = (
    await write('create_items', {
      catalog_node_id: container,
      count: 1,
      display_name: '厨房',
      initial_attributes: [attr('container', { can_contain: true })],
    })
  ).affected_objects[0].id;
  fridge = (
    await write('create_items', {
      catalog_node_id: container,
      count: 1,
      parent_id: room,
      display_name: '冰箱',
      initial_attributes: [attr('container', { can_contain: true })],
    })
  ).affected_objects[0].id;
});
afterAll(() => pool.end());
it('restocks without policy bootstrap, keeps unknowns, returns full paths and recovers the exact receipt', async () => {
  const input = await batch(undefined, {
    defaults: { parent_id: fridge },
    lines: [{ product: { catalog_node_id: sku }, instances: [{ count: 2 }] }],
  });
  const r = await execute(ctx, 'commit_intake', input);
  expect(r.receipt.item_count).toBe(2);
  expect(r.receipt.created_catalog).toEqual([]);
  expect(r.receipt.items[0].attributes).toEqual([]);
  expect(r.receipt.items[0].path.slice(0, 2).map((p: any) => p.name)).toEqual(['厨房', '冰箱']);
  // Pretend successful response was lost. Neither receipt recovery nor retry creates anything.
  expect(await execute(ctx, 'commit_intake', input)).toEqual(r);
  expect(
    await execute(ctx, 'get_intake_receipt', { idempotency_key: input.idempotency_key }),
  ).toEqual(r);
  expect(await execute(ctx, 'get_intake_receipt', { operation_id: r.operation_id })).toEqual(r);
  expect((await execute(ctx, 'query_items', { catalog_node_ids: [sku] })).matching_count).toBe(2);
});
it('creates a new product directly and permitted groups atomically, keeping individual weights and shared dates', async () => {
  await installRule();
  const input = await batch(newProduct(), {
    defaults: {
      parent_id: fridge,
      initial_attributes: [attr('lifecycle', { expiry: { date: '2026-12-01' } })],
    },
  });
  input.lines[0].instances = [
    {
      count: 1,
      initial_attributes: [attr('contents', { remaining: { value: '310', unit: 'g' } })],
    },
    {
      count: 1,
      initial_attributes: [
        attr('contents', { remaining: { value: '470', unit: 'g' } }),
        attr('lifecycle', { opening: { state: 'OPENED' } }),
      ],
    },
  ] as any;
  const result = await execute(ctx, 'commit_intake', input);
  expect(result.receipt.created_catalog).toHaveLength(1);
  expect(new Set(result.receipt.items.map((i: any) => i.catalog_node_id)).size).toBe(1);
  expect(
    result.receipt.items
      .map(
        (i: any) =>
          i.attributes.find((a: any) => a.template_id === 'contents').values.remaining.value,
      )
      .sort(),
  ).toEqual(['310', '470']);
  for (const i of result.receipt.items)
    expect(i.attributes.find((a: any) => a.template_id === 'lifecycle').values.expiry.date).toBe(
      '2026-12-01',
    );
  const expanded = await execute(
    ctx,
    'commit_intake',
    await batch(newProduct('鳕鱼', { new_groups: ['水产'] })),
  );
  expect(expanded.receipt.created_catalog).toHaveLength(2);
  expect(new Set(expanded.event_ids).size).toBe(3);
});
it('requires a concrete rule or exact one-time approval and never lets source strings or booleans authorize', async () => {
  const raw = await batch(newProduct());
  await expect(execute(ctx, 'commit_intake', raw)).rejects.toMatchObject({
    code: 'POLICY_REQUIRED',
  });
  await expect(
    execute({ ...ctx, source: 'MCP_UI' }, 'create_catalog_node', {
      kind: 'GROUP',
      name: '偷偷扩展',
      idempotency_key: key(),
    }),
  ).rejects.toMatchObject({ code: 'APPROVAL_REQUIRED' });
  const { idempotency_key: _, ...intake } = raw;
  const approval = await proposalApproval({
    kind: 'intake_exception',
    intake,
    reason: '只批准这批食品，暂不设长期规范',
  });
  expect((await execute(ctx, 'query_catalog_nodes', { name: '鸡胸肉' })).matching_count).toBe(0);
  await expect(
    execute(ctx, 'commit_intake', {
      ...raw,
      approval_id: approval.approval_id,
      lines: [{ product: newProduct('另一种肉'), instances: [{ count: 1 }] }],
    }),
  ).rejects.toMatchObject({ code: 'APPROVAL_REQUIRED' });
  const result = await execute(ctx, 'commit_intake', { ...raw, approval_id: approval.approval_id });
  expect(result.receipt.item_count).toBe(1);
  await expect(
    execute(ctx, 'commit_intake', {
      ...raw,
      idempotency_key: key(),
      approval_id: approval.approval_id,
    }),
  ).rejects.toMatchObject({ code: 'APPROVAL_REQUIRED' });
  expect((await execute(ctx, 'get_catalog_policy', {})).revision).toBe(0);
});
it('uses confirmed aliases, preserves real variants, and rejects same-name incomplete identity', async () => {
  await installRule({ aliases: [{ name: '牛奶', catalog_node_id: sku }] });
  const alias = await execute(
    ctx,
    'commit_intake',
    await batch(newProduct('牛奶', { initial_attributes: [] })),
  );
  expect(alias.receipt.items[0].catalog_node_id).toBe(sku);
  await expect(
    execute(ctx, 'commit_intake', await batch(newProduct('鲜奶', { initial_attributes: [] }))),
  ).rejects.toMatchObject({ code: 'AMBIGUOUS_PRODUCT' });
  const variant = await execute(
    ctx,
    'commit_intake',
    await batch(
      newProduct('鲜奶', {
        initial_attributes: [attr('product', { brand: '农场乙', specification: '2L' })],
      }),
    ),
  );
  expect(variant.receipt.created_catalog).toHaveLength(1);
  expect(variant.receipt.items[0].catalog_node_id).not.toBe(sku);
  await expect(
    execute(
      ctx,
      'commit_intake',
      await batch(
        newProduct('牛奶', { initial_attributes: [attr('product', { brand: '另一品牌' })] }),
      ),
    ),
  ).rejects.toMatchObject({ code: 'AMBIGUOUS_PRODUCT' });
});
it('checks all matching records beyond the first page and uses one SKU across concurrent members', async () => {
  await installRule();
  for (let i = 0; i < 3; i++)
    await approved('create_catalog_node', {
      kind: 'SKU',
      name: `测试商品 ${i}`,
      parent_id: branch,
    });
  const first = await execute(ctx, 'get_intake_context', { names: ['测试商品'], limit: 1 });
  expect(first.catalog).toMatchObject({ complete: false, matching_count: 3, next_cursor: 1 });
  const later = await execute(ctx, 'get_intake_context', {
    names: ['测试商品'],
    limit: 1,
    cursor: 2,
  });
  expect(later.catalog.complete).toBe(false);
  const input = await batch(newProduct());
  const other = { ...ctx, actor_id: 'actor_' + key() };
  await query(pool, "INSERT INTO actors(id,household_id,name) VALUES($1,$2,'Other member')", [
    other.actor_id,
    ctx.household_id,
  ]);
  const results = await Promise.all([
    execute(ctx, 'commit_intake', input),
    execute(other, 'commit_intake', { ...input, idempotency_key: key() }),
  ]);
  expect(results[0].receipt.items[0].catalog_node_id).toBe(
    results[1].receipt.items[0].catalog_node_id,
  );
  expect(results[0].receipt.items[0].id).not.toBe(results[1].receipt.items[0].id);
  expect((await execute(ctx, 'query_catalog_nodes', { name: '鸡胸肉' })).matching_count).toBe(1);
  await expect(
    execute(other, 'get_intake_receipt', { idempotency_key: input.idempotency_key }),
  ).rejects.toMatchObject({ code: 'NOT_FOUND' });
});
it('rolls back every new group, SKU, item, index, event, approval consumption and receipt on a late failure', async () => {
  await installRule();
  const counts = async () => {
    const result: any = {};
    for (const table of ['catalog_nodes', 'items', 'events', 'operations', 'catalog_identity_keys'])
      result[table] = (
        await query(pool, `SELECT count(*) FROM ${table} WHERE household_id=$1`, [ctx.household_id])
      ).rows[0].count;
    return result;
  };
  const input = await batch(newProduct('鳕鱼', { new_groups: ['水产'] }));
  input.lines[0].instances = [
    { count: 1 },
    { count: 1, initial_attributes: [attr('contents', { remaining: { value: '-2', unit: 'g' } })] },
  ] as any;
  const before = await counts();
  await expect(execute(ctx, 'commit_intake', input)).rejects.toMatchObject({
    code: 'ATTRIBUTE_VALIDATION_FAILED',
  });
  expect(await counts()).toEqual(before);
});
it('rejects changed policy, product, location ancestry and cross-household dependencies without force-retry', async () => {
  await installRule();
  const old = await batch(newProduct(), { defaults: { parent_id: fridge } });
  await write('update_item', {
    item_id: room,
    display_name: '厨房改名',
    expected_revisions: { [room]: 1 },
  });
  await expect(execute(ctx, 'commit_intake', old)).rejects.toMatchObject({
    code: 'REVISION_CONFLICT',
    details: { id: room },
  });
  const next = await batch(newProduct());
  await installRule({ allow_new_groups: false });
  await expect(execute(ctx, 'commit_intake', next)).rejects.toMatchObject({
    code: 'POLICY_CONFLICT',
  });
  const missing = await batch();
  missing.lines[0].product = { catalog_node_id: 'catalog_node_' + key() };
  await expect(execute(ctx, 'commit_intake', missing)).rejects.toMatchObject({ code: 'NOT_FOUND' });
});
it('keeps governance independent, binds UI confirmation to scope/content/dependencies, and marks historical exceptions', async () => {
  const p = await context([branch, sku]);
  const result = await write('propose_catalog_change', {
    proposal: {
      kind: 'policy',
      policy_revision: 0,
      expected_revisions: p.expected_revisions,
      rule: rule({ allow_direct_products: false }),
      reason: '之后需专门子类，现有记录保留',
    },
  });
  const review = await reviewCatalogProposal(ctx, 'A', { proposal_id: result.proposal_id });
  await expect(
    confirmCatalogProposal(ctx, 'B', {
      proposal_id: result.proposal_id,
      challenge: review.challenge,
    }),
  ).rejects.toMatchObject({ code: 'APPROVAL_EXPIRED' });
  await expect(
    confirmCatalogProposal(ctx, 'A', {
      proposal_id: result.proposal_id,
      challenge: 'x'.repeat(43),
    }),
  ).rejects.toMatchObject({ code: 'APPROVAL_EXPIRED' });
  await confirmCatalogProposal(ctx, 'A', {
    proposal_id: result.proposal_id,
    challenge: review.challenge,
  });
  expect((await execute(ctx, 'get_catalog_node', { catalog_node_id: sku })).parent_id).toBe(branch);
  await expect(write('create_items', { catalog_node_id: sku, count: 1 })).rejects.toMatchObject({
    code: 'CLASSIFICATION_CONFLICT',
  });
  await installRule({ allow_direct_products: false, legacy_exceptions: [sku] });
  expect((await execute(ctx, 'commit_intake', await batch())).receipt.item_count).toBe(1);
  const command = { kind: 'GROUP', name: '临时目录', idempotency_key: key(), parent_id: branch };
  const authorized = await approvedInput(ctx, 'create_catalog_node', command);
  await installRule();
  await expect(execute(ctx, 'create_catalog_node', authorized)).rejects.toMatchObject({
    code: 'POLICY_CONFLICT',
  });
});
it('caps physical tasks, rejects weight/location/fallback categories and does not infer authorization from confirmed=true', async () => {
  await installRule();
  for (const name of ['其他', '310g', '冰箱'])
    await expect(
      execute(ctx, 'commit_intake', await batch(newProduct('鱼', { new_groups: [name] }))),
    ).rejects.toMatchObject({ code: 'CLASSIFICATION_CONFLICT' });
  const tooMany = await batch(undefined, {
    lines: [{ product: { catalog_node_id: sku }, instances: [{ count: 60 }, { count: 41 }] }],
  });
  await expect(execute(ctx, 'commit_intake', tooMany)).rejects.toMatchObject({
    code: 'ATTRIBUTE_VALIDATION_FAILED',
  });
  await expect(
    execute(ctx, 'commit_intake', { ...(await batch()), confirmed: true }),
  ).rejects.toMatchObject({ code: 'ATTRIBUTE_VALIDATION_FAILED' });
});
it('keeps confirmation outside generic HTTP/model commands and hides its challenge in app metadata', async () => {
  const app = await buildApp(ctx, 'c'.repeat(64), false);
  const address = await app.listen({ host: '127.0.0.1', port: 0 });
  const client = new McpClient({ name: 'intake-boundary', version: '1' });
  try {
    await client.connect(
      new StreamableHTTPClientTransport(new URL(address + '/mcp'), {
        requestInit: { headers: { Authorization: 'Bearer ' + 'c'.repeat(64) } },
      }),
    );
    const view = await client.callTool({ name: 'open_inventory', arguments: {} });
    const scope = (view._meta?.['acornary/view'] as any).session.cache_key;
    const proposal = await write('propose_catalog_change', {
      proposal: {
        kind: 'catalog_command',
        operation: 'create_catalog_node',
        input: { kind: 'GROUP', name: '工具测试', idempotency_key: key() },
        reason: '边界测试',
      },
    });
    const review = await client.callTool({
      name: 'get_catalog_review',
      arguments: { proposal_id: proposal.proposal_id, expected_scope: scope },
    });
    expect(review.structuredContent).toBeUndefined();
    const hidden = review._meta?.['acornary/catalog-review'] as any;
    expect(hidden.challenge.length).toBeGreaterThan(32);
    expect(JSON.stringify(review.content)).not.toContain(hidden.challenge);
    const tools = await client.listTools();
    expect(tools.tools.find((t) => t.name === 'confirm_catalog_change')?._meta?.ui).toEqual({
      visibility: ['app'],
    });
    const denied = await app.inject({
      method: 'POST',
      url: '/api/write/confirm_catalog_change',
      headers: { origin: 'http://localhost:80', 'x-acornary-request': 'web' },
      payload: { proposal_id: proposal.proposal_id, challenge: hidden.challenge },
    });
    expect(denied.statusCode).toBe(403);
    const wrong = await client.callTool({
      name: 'confirm_catalog_change',
      arguments: {
        proposal_id: proposal.proposal_id,
        challenge: hidden.challenge,
        expected_scope: 'wrong',
      },
    });
    expect(wrong.isError).toBe(true);
    const confirmed = await client.callTool({
      name: 'confirm_catalog_change',
      arguments: {
        proposal_id: proposal.proposal_id,
        challenge: hidden.challenge,
        expected_scope: scope,
      },
    });
    expect(confirmed.isError).not.toBe(true);
  } finally {
    await client.close();
    await app.close();
  }
});

it('supports exact top-level exceptions, normalized concurrent identity and an expired or foreign confirmation', async () => {
  const raw = await batch(newProduct('红茶', { parent_id: null, new_groups: ['饮品'] }));
  const { idempotency_key: _, ...intake } = raw;
  const approval = await proposalApproval({
    kind: 'intake_exception',
    intake,
    reason: '本次在根下创建明确的新分支',
  });
  const result = await execute(ctx, 'commit_intake', { ...raw, approval_id: approval.approval_id });
  expect(result.receipt.created_catalog).toHaveLength(2);
  await installRule();
  const first = await execute(
    ctx,
    'commit_intake',
    await batch(
      newProduct('ＡＢＣ食品', {
        initial_attributes: [attr('product', { brand: 'FOO', specification: '500g' })],
      }),
    ),
  );
  const next = await execute(
    ctx,
    'commit_intake',
    await batch(
      newProduct('abc食品', {
        initial_attributes: [attr('product', { brand: ' foo ', specification: '500g' })],
      }),
    ),
  );
  expect(first.receipt.items[0].catalog_node_id).toBe(next.receipt.items[0].catalog_node_id);
  const p = await write('propose_catalog_change', {
    proposal: {
      kind: 'catalog_command',
      operation: 'create_catalog_node',
      input: { kind: 'GROUP', name: '未确认分类', idempotency_key: key() },
      reason: '测试过期和身份绑定',
    },
  });
  const review = await reviewCatalogProposal(ctx, 'test-ui', { proposal_id: p.proposal_id });
  await query(
    pool,
    "UPDATE catalog_proposals SET challenge_expires_at=now()-interval '1 second' WHERE id=$1",
    [p.proposal_id],
  );
  await expect(
    confirmCatalogProposal(ctx, 'test-ui', {
      proposal_id: p.proposal_id,
      challenge: review.challenge,
    }),
  ).rejects.toMatchObject({ code: 'APPROVAL_EXPIRED' });
  const other = { ...ctx, actor_id: 'actor_' + key() };
  await query(pool, "INSERT INTO actors(id,household_id,name) VALUES($1,$2,'Another member')", [
    other.actor_id,
    ctx.household_id,
  ]);
  await expect(
    reviewCatalogProposal(other, 'test-ui', { proposal_id: p.proposal_id }),
  ).rejects.toMatchObject({ code: 'NOT_FOUND' });
  expect((await execute(ctx, 'get_catalog_policy', { revision: 1 })).revision).toBe(1);
});

it('returns referenced dependencies beyond a truncated page, known barcode matches and accurate empty-page coverage', async () => {
  await approved('bind_attributes', {
    target: { kind: 'CATALOG_NODE', id: sku },
    template_id: 'device',
    template_version: 1,
    values: { connector: 'USB-C' },
    expected_revisions: { [sku]: 1 },
  });
  await approved('update_attributes', {
    target: { kind: 'CATALOG_NODE', id: sku },
    template_id: 'product',
    template_version: 1,
    set: { barcodes: ['KNOWN-CODE'] },
    expected_revisions: { [sku]: 2 },
  });
  const matched = await execute(ctx, 'get_intake_context', { barcodes: ['KNOWN-CODE'] });
  expect(matched.catalog.candidates.map((n: any) => n.id)).toEqual([sku]);
  const page = await execute(ctx, 'get_intake_context', {
    catalog_node_ids: [branch, sku],
    limit: 1,
    cursor: 100,
  });
  expect(page.catalog).toMatchObject({ matching_count: 2, complete: false, candidates: [] });
  expect(page.referenced_catalog).toHaveLength(2);
  expect(page.expected_revisions[sku]).toBe(3);
});

it('does not discard new or conflicting nonidentity facts when reusing a SKU, and enforces runtime grants', async () => {
  await installRule();
  const candidate = newProduct('鲜奶', {
    initial_attributes: [
      attr('product', {
        brand: '农场甲',
        specification: '1L',
        storage: { requirement: 'REFRIGERATED' },
      }),
    ],
  });
  await expect(execute(ctx, 'commit_intake', await batch(candidate))).rejects.toMatchObject({
    code: 'AMBIGUOUS_PRODUCT',
  });
  expect(
    (await execute(ctx, 'get_catalog_node', { catalog_node_id: sku })).attributes[0].values,
  ).not.toHaveProperty('storage');
  const { readFile } = await import('node:fs/promises');
  const client = await pool.connect();
  try {
    await client.query(
      "DO $$ BEGIN IF NOT EXISTS(SELECT FROM pg_roles WHERE rolname='acornary_app') THEN CREATE ROLE acornary_app NOLOGIN; END IF; END $$",
    );
    await client.query(await readFile('deploy/grants.sql', 'utf8'));
    const privileges = (
      await client.query(
        "SELECT has_table_privilege('acornary_app','catalog_policy_versions','INSERT') AS policy_insert,has_table_privilege('acornary_app','catalog_policy_versions','UPDATE') AS policy_update,has_table_privilege('acornary_app','catalog_proposals','UPDATE') AS proposal_update,has_table_privilege('acornary_app','catalog_identity_keys','DELETE') AS identity_delete",
      )
    ).rows[0];
    expect(privileges).toEqual({
      policy_insert: true,
      policy_update: false,
      proposal_update: true,
      identity_delete: true,
    });
    await expect(
      client.query('DELETE FROM catalog_policy_versions WHERE household_id=$1', [ctx.household_id]),
    ).rejects.toThrow('append-only');
  } finally {
    client.release();
  }
});

it('cannot bypass a stricter child rule by describing its existing path as a new extension', async () => {
  await installRule();
  const child = (
    await approved('create_catalog_node', { kind: 'GROUP', name: '限制分支', parent_id: branch })
  ).affected_objects[0].id;
  const p = await context([child]);
  await proposalApproval({
    kind: 'policy',
    policy_revision: p.policy_revision,
    expected_revisions: p.expected_revisions,
    rule: rule({ branch_id: child, allow_direct_products: false, allow_new_groups: false }),
    reason: '此分支暂停新增商品',
  });
  await expect(
    execute(ctx, 'commit_intake', await batch(newProduct('新肉类', { new_groups: ['限制分支'] }))),
  ).rejects.toMatchObject({ code: 'CLASSIFICATION_CONFLICT' });
  expect((await execute(ctx, 'query_catalog_nodes', { name: '新肉类' })).matching_count).toBe(0);
});
