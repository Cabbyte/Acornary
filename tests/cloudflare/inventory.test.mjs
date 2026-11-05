import { readFile } from 'node:fs/promises';
import { before, after, test } from 'node:test';
import assert from 'node:assert/strict';
import { Miniflare, convertV4MiniflareOptions } from 'miniflare';
let mf;
const covered = new Set();
before(async () => {
  mf = new Miniflare(
    convertV4MiniflareOptions({
      modules: true,
      scriptPath: 'output/cloudflare-inventory/inventory-worker.js',
      compatibilityDate: '2026-11-05',
      compatibilityFlags: ['nodejs_compat'],
      r2Buckets: { BLOBS: 'inventory-blobs' },
      durableObjects: { HOUSEHOLDS: { className: 'TestInventory', useSQLite: true } },
    }),
  );
});
after(async () => {
  await mf?.dispose();
});
const id = (prefix) => prefix + '_' + crypto.randomUUID();
async function household() {
  const route = id('household'),
    actor = id('actor'),
    user = crypto.randomUUID();
  async function invoke(method, ...args) {
    const response = await mf.dispatchFetch('https://test.invalid/', {
      method: 'POST',
      body: JSON.stringify({ route, method, args }),
    });
    const data = await response.json();
    if (!response.ok)
      throw Object.assign(new Error(data.message), { code: data.code, remoteStack: data.stack });
    return data;
  }
  await invoke('create', {
    household_id: route,
    actor_id: actor,
    user_id: user,
    membership_id: crypto.randomUUID(),
    name: '测试家庭',
    actor_name: '测试用户',
    timezone: 'Asia/Shanghai',
    operation_id: crypto.randomUUID(),
  });
  const ctx = { household_id: route, actor_id: actor, user_id: user, source: 'TEST' };
  const run = async (name, input = {}) => {
    const result = await invoke('command', ctx, name, input);
    covered.add(name);
    return result;
  };
  const write = (name, input = {}) => run(name, { idempotency_key: crypto.randomUUID(), ...input });
  async function approved(name, input) {
    const command = { idempotency_key: crypto.randomUUID(), ...input };
    const proposal = await write('propose_catalog_change', {
      proposal: {
        kind: 'catalog_command',
        operation: name,
        input: command,
        reason: 'Explicit synthetic fixture governance',
      },
    });
    const review = await invoke('review', ctx, 'isolated-test-ui', {
      proposal_id: proposal.proposal_id,
    });
    const confirm = await invoke('confirm', ctx, 'isolated-test-ui', {
      proposal_id: proposal.proposal_id,
      challenge: review.challenge,
    });
    return run(name, { ...command, approval_id: confirm.approval_id });
  }
  return { ctx, run, write, approved, invoke };
}
test('full native command commits inventory, history, sync and receipt atomically', async () => {
  const h = await household();
  const catalog = await h.approved('create_catalog_node', {
    kind: 'SKU',
    name: '牛奶',
    profile: 'CONSUMABLE',
  });
  const sku = catalog.affected_objects[0].id;
  const input = {
    catalog_node_id: sku,
    count: 2,
    idempotency_key: crypto.randomUUID(),
    initial_attributes: [
      {
        template_id: 'contents',
        template_version: 1,
        values: { remaining: { value: '1000', unit: 'mL' } },
      },
    ],
  };
  const created = await h.run('create_items', input);
  assert.deepEqual(await h.run('create_items', input), created);
  const item = created.affected_objects[0].id;
  const stock = await h.run('query_items', {});
  assert.equal(stock.matching_count, 2);
  assert.equal(stock.content_totals.by_unit.mL.value, '2000');
  const consumed = await h.write('consume_item_content', {
    item_id: item,
    amount: { value: '100', unit: 'mL' },
    expected_revisions: { [item]: 1 },
  });
  assert.equal(consumed.affected_objects[0].after_revision, 2);
  const detail = await h.run('get_item', { item_id: item });
  assert.equal(
    detail.attributes.find((a) => a.template_id === 'contents').values.remaining.value,
    '900',
  );
  const history = await h.run('get_history', { target: { kind: 'ITEM', id: item } });
  assert.equal(history.data.length, 2);
  const state = await h.invoke('synchronize', h.ctx, 'state', {});
  const changes = await h.invoke('synchronize', h.ctx, 'changes', {
    generation: state.generation,
    cursor: '0',
    limit: 200,
  });
  assert.equal(changes.changes.length, 4);
  assert.equal((await h.invoke('snapshot', h.ctx)).items.length, 2);
});

async function fixture(h, count = 1, attributes = []) {
  const sku = (await h.approved('create_catalog_node', { kind: 'SKU', name: '家庭用品' }))
    .affected_objects[0].id;
  const result = await h.write('create_items', {
    catalog_node_id: sku,
    count,
    initial_attributes: attributes,
  });
  return { sku, items: result.affected_objects.map((a) => a.id) };
}
const attr = (template_id, values, template_version = 1) => ({
  template_id,
  template_version,
  values,
});

test('revision conflicts and injected receipt failure roll back all business facts', async () => {
  const h = await household(),
    {
      items: [item],
    } = await fixture(h, 1, [attr('contents', { remaining: { value: '10', unit: 'mL' } })]);
  const before = await h.invoke('snapshot', h.ctx);
  await h.invoke(
    'inspect',
    "CREATE TRIGGER reject_new_receipt BEFORE INSERT ON operations BEGIN SELECT RAISE(ABORT,'Injected receipt failure'); END",
  );
  await assert.rejects(
    h.write('consume_item_content', {
      item_id: item,
      amount: { value: '3', unit: 'mL' },
      expected_revisions: { [item]: 1 },
    }),
    /integrity check rejected/,
  );
  const after = await h.invoke('snapshot', h.ctx);
  assert.deepEqual(
    { ...after, server_time: null, cached_at: null },
    { ...before, server_time: null, cached_at: null },
  );
  await h.invoke('inspect', 'DROP TRIGGER reject_new_receipt');
  const results = await Promise.allSettled(
    Array.from({ length: 10 }, () =>
      h.write('consume_item_content', {
        item_id: item,
        amount: { value: '3', unit: 'mL' },
        expected_revisions: { [item]: 1 },
      }),
    ),
  );
  assert.equal(results.filter((r) => r.status === 'fulfilled').length, 1);
  assert.equal(
    (await h.run('get_item', { item_id: item })).attributes.find(
      (a) => a.template_id === 'contents',
    ).values.remaining.value,
    '7',
  );
});

test('membership check precedes both reads and idempotency replay; write fence blocks mutations', async () => {
  const h = await household(),
    {
      items: [item],
    } = await fixture(h);
  const input = {
    item_id: item,
    display_name: '私人物品',
    expected_revisions: { [item]: 1 },
    idempotency_key: crypto.randomUUID(),
  };
  await h.run('update_item', input);
  await h.invoke('inspect', "UPDATE cf_store_state SET status='FROZEN'");
  await assert.rejects(h.run('update_item', input), /temporarily paused/);
  await h.invoke('inspect', "UPDATE cf_store_state SET status='ACTIVE'");
  await assert.rejects(
    h.invoke('command', { ...h.ctx, user_id: 'different-user' }, 'get_item', { item_id: item }),
    /membership/,
  );
  await h.invoke('inspect', 'DELETE FROM household_members');
  await assert.rejects(h.run('update_item', input), /membership/);
  await assert.rejects(h.run('query_items', {}), /membership/);
});

test('notes preserve sensitivity, audit reveals, and redact replay after reclassification', async () => {
  const h = await household(),
    {
      items: [item],
    } = await fixture(h);
  const input = {
    target: { kind: 'ITEM', id: item },
    title: '发票',
    body: '保修凭据',
    expected_revisions: { [item]: 1 },
    idempotency_key: crypto.randomUUID(),
  };
  const note = await h.run('add_note', input);
  assert.equal((await h.run('get_note', { note_id: note.note_id })).body, '保修凭据');
  await h.write('update_note', {
    note_id: note.note_id,
    body: '凭据密码',
    sensitivity: 'SECRET',
    expected_revisions: { [item]: 2 },
  });
  const replay = await h.run('add_note', input);
  assert.ok(!('excerpt' in replay.note));
  assert.ok(!('body' in (await h.run('get_note', { note_id: note.note_id }))));
  assert.equal(
    (await h.run('get_note', { note_id: note.note_id, reveal_sensitive: true })).body,
    '凭据密码',
  );
  assert.equal(
    (await h.invoke('inspect', 'SELECT count(*) AS n FROM sensitive_access_audit'))[0].n,
    1,
  );
});

test('frozen export remains consistent after writes and rejects changed query', async () => {
  const h = await household(),
    {
      items: [item],
    } = await fixture(h, 3);
  const frozen = await h.run('begin_export', { kind: 'ITEM' });
  assert.equal(frozen.matching_count, 3);
  await h.write('update_item', {
    item_id: item,
    display_name: '修改后的名称',
    expected_revisions: { [item]: 1 },
  });
  const first = await h.run('read_export', { kind: 'ITEM', export_id: frozen.export_id, limit: 2 });
  const second = await h.run('read_export', {
    kind: 'ITEM',
    export_id: frozen.export_id,
    limit: 2,
    cursor: first.next_cursor,
  });
  assert.equal(second.data.length, 1);
  assert.ok([...first.data, ...second.data].every((row) => row.display_name !== '修改后的名称'));
  await assert.rejects(
    h.run('read_export', { kind: 'ITEM', export_id: frozen.export_id, query: { search: '更改' } }),
    /export/i,
  );
  assert.equal((await h.run('cancel_export', { export_id: frozen.export_id })).cancelled, true);
});

test('bigint sync cursors stay exact and history pagination retains microsecond ties', async () => {
  const h = await household(),
    {
      items: [item],
    } = await fixture(h);
  await h.invoke(
    'inspect',
    "UPDATE household_sync_state SET last_committed_change_id='9007199254740993'",
  );
  const changed = await h.write('update_item', {
    item_id: item,
    display_name: '游标测试',
    expected_revisions: { [item]: 1 },
  });
  const state = await h.invoke('synchronize', h.ctx, 'state', {});
  assert.equal(state.last_change_id, '9007199254740994');
  const page = await h.invoke('synchronize', h.ctx, 'changes', {
    generation: state.generation,
    cursor: '9007199254740993',
  });
  assert.equal(page.changes[0].change_id, '9007199254740994');
  // Fixture-only timestamp injection; production event rows are append-only.
  await h.invoke('inspect', 'DROP TRIGGER immutable_events_update');
  // Two valid events in the same millisecond must remain distinct pagination positions.
  await h.invoke(
    'inspect',
    "UPDATE events SET recorded_at='2026-01-01T00:00:00.123456Z' WHERE id=?1",
    [changed.event_ids[0]],
  );
  const first = await h.run('get_history', { target: { kind: 'ITEM', id: item }, limit: 1 });
  const second = await h.run('get_history', {
    target: { kind: 'ITEM', id: item },
    limit: 1,
    cursor: first.next_cursor,
  });
  assert.equal(new Set([...first.data, ...second.data].map((e) => e.id)).size, 2);
});

test('date projection uses household calendar and preserves deadlines on completion', async () => {
  const h = await household(),
    {
      items: [item],
    } = await fixture(h, 1, [
      attr(
        'lifecycle',
        {
          state: 'ACTIVE',
          opening: { state: 'OPENED', opened_at: '2026-01-01T20:00:00Z' },
          expiry: { after_opening_days: 2 },
        },
        2,
      ),
    ]);
  let detail = await h.run('get_item', { item_id: item });
  assert.equal(detail.reminder_date, '2026-01-04');
  const added = await h.write('add_deadline', {
    item_id: item,
    entry: { kind: 'SERVICE_DUE', due_on: '2026-01-03' },
    expected_revisions: { [item]: 1 },
  });
  detail = await h.run('get_item', { item_id: item });
  assert.equal(detail.reminder_date, '2026-01-03');
  assert.equal(
    (
      await h.run('query_items', {
        date_filters: [{ kind: 'SERVICE_DUE', from: '2026-01-03', to: '2026-01-03' }],
      })
    ).matching_count,
    1,
  );
});

test('R2 attachment upload verifies full 25 MiB bytes, replays confirmation, and enforces private download', async () => {
  const h = await household(),
    {
      items: [item],
    } = await fixture(h),
    size = 25 * 1024 * 1024;
  const bytes = Buffer.alloc(size, 65);
  bytes.write('%PDF-1.7\n');
  const sha = Buffer.from(await crypto.subtle.digest('SHA-256', bytes)).toString('hex');
  const reserved = await h.write('create_attachment_upload', {
    filename: 'test.pdf',
    mime_type: 'application/pdf',
    target: { kind: 'ITEM', id: item },
    file_size: size,
    sha256: sha,
  });
  const upload = () =>
    mf.dispatchFetch('https://test.invalid/upload', {
      method: 'PUT',
      headers: {
        'x-test-identity': JSON.stringify(h.ctx),
        'x-test-upload': reserved.upload_id,
        'x-test-ticket': reserved.headers['X-Acornary-Upload-Ticket'],
      },
      body: bytes,
    });
  let response = await upload();
  assert.equal(response.status, 200, await response.clone().text());
  assert.deepEqual(await response.json(), { uploaded: true });
  response = await upload();
  assert.equal(response.status, 200, await response.clone().text());
  const complete = await h.write('complete_attachment_upload', {
    upload_id: reserved.upload_id,
    target: { kind: 'ITEM', id: item },
    sensitivity: 'SECRET',
    expected_revisions: { [item]: 1 },
  });
  const attachment = complete.attachment.id;
  const download = (reveal, identity = h.ctx) =>
    mf.dispatchFetch('https://test.invalid/download', {
      headers: {
        'x-test-identity': JSON.stringify(identity),
        'x-test-attachment': attachment,
        'x-test-reveal': String(reveal),
      },
    });
  assert.equal((await download(false)).status, 400);
  assert.equal((await download(true, { ...h.ctx, user_id: 'different-user' })).status, 400);
  response = await download(true);
  assert.equal(response.status, 200, await response.clone().text());
  assert.equal(response.headers.get('cache-control'), 'no-store');
  assert.equal(
    Buffer.from(await crypto.subtle.digest('SHA-256', await response.arrayBuffer())).toString(
      'hex',
    ),
    sha,
  );
  await h.write('detach_attachment', {
    attachment_id: attachment,
    expected_revisions: { [item]: 2 },
  });
  assert.equal((await download(true)).status, 400);
});

test('upload checksum failures remain unconfirmed and cannot be attached', async () => {
  const h = await household(),
    {
      items: [item],
    } = await fixture(h),
    bytes = Buffer.from('%PDF-1.7\nwrong checksum');
  const reserved = await h.write('create_attachment_upload', {
    filename: 'test.pdf',
    mime_type: 'application/pdf',
    target: { kind: 'ITEM', id: item },
    file_size: bytes.length,
    sha256: 'a'.repeat(64),
  });
  const response = await mf.dispatchFetch('https://test.invalid/upload', {
    method: 'PUT',
    headers: {
      'x-test-identity': JSON.stringify(h.ctx),
      'x-test-upload': reserved.upload_id,
      'x-test-ticket': reserved.headers['X-Acornary-Upload-Ticket'],
    },
    body: bytes,
  });
  assert.equal(response.status, 400);
  assert.match((await response.json()).message, /checksum/);
  await assert.rejects(
    h.write('complete_attachment_upload', {
      upload_id: reserved.upload_id,
      target: { kind: 'ITEM', id: item },
      expected_revisions: { [item]: 1 },
    }),
    /upload/i,
  );
  assert.equal((await h.invoke('inspect', 'SELECT count(*) AS n FROM attachment_blobs'))[0].n, 0);
});

test('native intake applies confirmed branch policy, creates products and recovers receipts', async () => {
  const h = await household();
  const branch = (await h.approved('create_catalog_node', { kind: 'GROUP', name: '食品' }))
    .affected_objects[0].id;
  const context = await h.run('get_intake_context', { catalog_node_ids: [branch] });
  const proposal = await h.write('propose_catalog_change', {
    proposal: {
      kind: 'policy',
      policy_revision: context.policy_revision,
      expected_revisions: context.expected_revisions,
      rule: {
        branch_id: branch,
        meaning: '食用食品',
        boundaries: '不含餐具和位置',
        subdivision_basis: '食品类型',
        allow_direct_products: true,
        allow_new_groups: true,
        max_new_depth: 2,
        naming_guidance: '具体食品',
        identity_fields: ['product.brand', 'product.specification'],
      },
      reason: '确认分类规则',
    },
  });
  const review = await h.invoke('review', h.ctx, 'test-ui', { proposal_id: proposal.proposal_id });
  await h.invoke('confirm', h.ctx, 'test-ui', {
    proposal_id: proposal.proposal_id,
    challenge: review.challenge,
  });
  const current = await h.run('get_intake_context', { catalog_node_ids: [branch] });
  const input = {
    idempotency_key: crypto.randomUUID(),
    policy_revision: current.policy_revision,
    expected_revisions: current.expected_revisions,
    lines: [
      {
        product: {
          name: '鸡胸肉',
          parent_id: branch,
          classification_reason: '食品分支允许',
          initial_attributes: [attr('product', { brand: '农场甲', specification: '散装' })],
        },
        instances: [
          {
            count: 2,
            initial_attributes: [attr('contents', { remaining: { value: '310', unit: 'g' } })],
          },
        ],
      },
    ],
  };
  const intake = await h.run('commit_intake', input);
  assert.equal(intake.receipt.item_count, 2);
  assert.equal(intake.receipt.created_catalog.length, 1);
  assert.deepEqual(await h.run('commit_intake', input), intake);
  assert.deepEqual(
    await h.run('get_intake_receipt', { operation_id: intake.operation_id }),
    intake,
  );
  assert.deepEqual(
    await h.run('get_intake_receipt', { idempotency_key: input.idempotency_key }),
    intake,
  );
  const matching = await h.run('get_intake_context', { names: ['鸡胸'] });
  assert.equal(matching.catalog.matching_count, 1);
  const catalog = await h.run('query_catalog_nodes', { search: '农场甲' });
  assert.equal(catalog.matching_count, 1);
});

test('split quantities conserve Decimal values and cannot restore the consumed source', async () => {
  const h = await household(),
    {
      sku,
      items: [source],
    } = await fixture(h, 1, [attr('contents', { remaining: { value: '0.3', unit: 'g' } })]);
  await assert.rejects(
    h.write('split_item', {
      source_item_id: source,
      target_catalog_node_id: sku,
      count: 3,
      child_attributes: [attr('contents', { remaining: { value: '0.2', unit: 'g' } })],
      expected_revisions: { [source]: 1, [sku]: 1 },
    }),
    /conserve/,
  );
  const split = await h.write('split_item', {
    source_item_id: source,
    target_catalog_node_id: sku,
    count: 3,
    child_attributes: [attr('contents', { remaining: { value: '0.1', unit: 'g' } })],
    expected_revisions: { [source]: 1, [sku]: 1 },
  });
  const children = split.affected_objects.filter((o) => o.id !== source).map((o) => o.id);
  assert.equal(children.length, 3);
  assert.equal((await h.run('get_item', { item_id: children[0] })).split.count, 3);
  assert.equal((await h.run('query_items', {})).content_totals.by_unit.g.value, '0.3');
  await assert.rejects(
    h.write('correct_item', {
      item_id: source,
      reason: '不能凭空恢复拆分前数量',
      attributes: [{ template_id: 'lifecycle', template_version: 2, set: { state: 'ACTIVE' } }],
      expected_revisions: { [source]: 2 },
    }),
    /split source/i,
  );
});

test('tree cycles, duplicate normalized group names and cross-household parents are rejected', async () => {
  const h = await household();
  const group = (await h.approved('create_catalog_node', { kind: 'GROUP', name: 'Ａ 食品' }))
    .affected_objects[0].id;
  await assert.rejects(
    h.approved('create_catalog_node', { kind: 'GROUP', name: 'a  食品' }),
    /distinct/,
  );
  const child = (
    await h.approved('create_catalog_node', { kind: 'GROUP', name: '子分类', parent_id: group })
  ).affected_objects[0].id;
  await assert.rejects(
    h.approved('move_catalog_node', {
      catalog_node_id: group,
      parent_id: child,
      expected_revisions: { [group]: 1 },
    }),
    { code: 'CYCLE_DETECTED' },
  );
  await h.approved('move_catalog_node', {
    catalog_node_id: child,
    parent_id: null,
    expected_revisions: { [child]: 1 },
  });
  const {
    items: [container],
  } = await fixture(h, 1, [attr('container', { can_contain: true })]);
  const {
    items: [nested],
  } = await fixture(h, 1, [attr('container', { can_contain: true })]);
  await h.write('move_item', {
    item_id: nested,
    parent_id: container,
    expected_revisions: { [nested]: 1 },
  });
  await assert.rejects(
    h.write('move_item', {
      item_id: container,
      parent_id: nested,
      expected_revisions: { [container]: 1 },
    }),
    { code: 'CYCLE_DETECTED' },
  );
  await assert.rejects(
    h.write('move_item', {
      item_id: container,
      parent_id: id('item'),
      expected_revisions: { [container]: 1 },
    }),
    /not found/i,
  );
});

test('remaining public commands preserve lifecycle, attribute, stock, note and deadline behavior', async () => {
  const h = await household();
  assert.equal((await h.run('get_connection_context', {})).household.id, h.ctx.household_id);
  assert.ok((await h.run('list_attribute_templates', {})).data.length > 10);
  assert.equal(
    (await h.run('get_attribute_template', { template_id: 'contents', template_version: 1 })).id,
    'contents',
  );
  assert.equal((await h.run('get_catalog_policy', {})).revision, 0);
  const {
    sku,
    items: [item],
  } = await fixture(h, 1, [attr('lifecycle', { state: 'ACTIVE' }, 1)]);
  const target = { kind: 'ITEM', id: item };
  const revision = async () => ({ [item]: (await h.run('get_item', { item_id: item })).revision });
  const mutate = async (name, args) =>
    h.write(name, { ...args, expected_revisions: await revision() });
  await mutate('open_item', { item_id: item, opened_at: '2026-01-01T00:00:00Z' });
  await mutate('upgrade_attributes', {
    target,
    template_id: 'lifecycle',
    from_version: 1,
    to_version: 2,
    values: { state: 'ACTIVE', opening: { state: 'OPENED', opened_at: '2026-01-01T00:00:00Z' } },
  });
  await mutate('bind_attributes', {
    target,
    template_id: 'usage',
    template_version: 1,
    values: { state: 'IDLE' },
  });
  await mutate('update_attributes', {
    target,
    template_id: 'usage',
    template_version: 1,
    set: { state: 'IN_USE' },
  });
  assert.equal((await h.run('get_item', { item_id: item })).derived_availability, 'UNAVAILABLE');
  await mutate('remove_attributes', { target, template_id: 'usage', template_version: 1 });
  await mutate('bind_attributes', {
    target,
    template_id: 'custody',
    template_version: 1,
    values: { holder: { kind: 'ACTOR', id: h.ctx.actor_id } },
  });
  assert.equal(
    (await h.run('query_references', { target: { kind: 'ACTOR', id: h.ctx.actor_id } })).data
      .length,
    1,
  );
  await mutate('edit_item', {
    item_id: item,
    display_name: '编辑后的物品',
    acquired_on: '2026-01-01',
    note: { body: '原子笔记' },
  });
  const notes = (await h.run('list_notes', { target })).data;
  assert.equal(notes.length, 1);
  await mutate('archive_note', { note_id: notes[0].id, archived: true });
  assert.equal((await h.run('list_notes', { target })).data.length, 0);
  assert.deepEqual((await h.run('list_attachments', { target })).data, []);
  await mutate('add_deadline', {
    item_id: item,
    entry: { kind: 'SERVICE_DUE', due_on: '2026-02-01', recurrence_days: 7 },
  });
  let detail = await h.run('get_item', { item_id: item });
  const entry_id = detail.attributes.find((a) => a.template_id === 'deadline').values.entries[0].id;
  await mutate('update_deadline', { item_id: item, entry_id, patch: { due_on: '2026-02-02' } });
  await mutate('complete_deadline', { item_id: item, entry_id, completed_on: '2026-02-02' });
  detail = await h.run('get_item', { item_id: item });
  assert.ok(detail.dates.some((d) => d.due_on === '2026-02-09'));
  await mutate('remove_deadline', { item_id: item, entry_id });
  await mutate('update_items_lifecycle', {
    items: [{ item_id: item, template_version: 2, set: { condition: 'GOOD' } }],
  });
  await mutate('move_items', { item_ids: [item], parent_id: null });
  const batch = await h.write('create_items_batch', {
    items: [
      { client_ref: 'one', catalog_node_id: sku },
      { client_ref: 'two', catalog_node_id: sku },
    ],
  });
  assert.equal(batch.affected_objects.length, 2);
  assert.equal(
    (await h.run('query_inventory_groups', {})).groups.find((g) => g.id === sku).current_count,
    3,
  );
  await h.approved('bind_attributes', {
    target: { kind: 'CATALOG_NODE', id: sku },
    template_id: 'stock',
    template_version: 1,
    values: { basis: 'COUNT', reorder_threshold: '4', target: '6' },
    expected_revisions: { [sku]: 1 },
  });
  const stock = await h.run('query_stock', { catalog_node_ids: [sku] });
  assert.equal(stock.data[0].low, true);
  assert.equal(stock.data[0].gap, '3');
  await h.approved('update_catalog_node', {
    catalog_node_id: sku,
    name: '新的商品名',
    expected_revisions: { [sku]: 2 },
  });
  await mutate('consume_items', { item_ids: [item] });
  await mutate('correct_item', {
    item_id: item,
    reason: '纠正误操作',
    attributes: [{ template_id: 'lifecycle', template_version: 2, set: { state: 'ACTIVE' } }],
  });
  await mutate('dispose_item', {
    item_id: item,
    disposition: { kind: 'DISCARD', date: '2026-02-03' },
  });
  const spare = batch.affected_objects[0].id;
  await h.write('void_item', {
    item_id: spare,
    reason: '重复录入',
    expected_revisions: { [spare]: 1 },
  });
  assert.equal((await h.run('get_item', { item_id: spare })).record_state, 'VOID');
  const empty = (await h.approved('create_catalog_node', { kind: 'SKU', name: '误建空商品' }))
    .affected_objects[0].id;
  await h.approved('void_catalog_node', {
    catalog_node_id: empty,
    reason: '重复建档',
    expected_revisions: { [empty]: 1 },
  });
  assert.equal((await h.run('get_catalog_node', { catalog_node_id: empty })).record_state, 'VOID');
});

test('every baseline operation executes successfully in the native runtime', async () => {
  const baseline = JSON.parse(await readFile('docs/cloudflare/contracts-baseline.json', 'utf8'));
  assert.deepEqual(
    Object.keys(baseline.operations).filter((name) => !covered.has(name)),
    [],
  );
});

test('native inspector exposes SQLite metadata with sensitive documents redacted', async () => {
  const h = await household();
  for (const table of [
    'households',
    'items',
    'events',
    'operations',
    'migrations',
    'installations',
  ]) {
    try {
      const result = await h.invoke('debug', h.ctx, { view: 'system', table });
      assert.ok(Array.isArray(result.rows));
    } catch (e) {
      console.error(e.remoteStack);
      throw e;
    }
  }
});
