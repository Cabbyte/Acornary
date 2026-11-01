import { describe, expect, it } from 'vitest';
import type {
  CatalogRecordV2,
  ItemDetailV2,
  SnapshotV2,
} from '../../packages/contracts/src/read-v2.js';
import type { InventorySnapshot } from '../../packages/contracts/src/web.js';
import {
  adaptCatalog,
  adaptGroup,
  adaptItemDetail,
  adaptSnapshot,
  adaptTemplateDefinition,
  dateState,
  effectiveCapabilities,
  hasCapability,
  reminderToFacts,
} from '../../apps/web/src/features/inventory/adapters/index.js';

const household = { id: 'household_1', name: '家', timezone: 'Asia/Shanghai' };

const v1Snapshot: InventorySnapshot = {
  household,
  container_catalog_id: 'sku_container',
  cached_at: '2026-10-31T12:00:00+08:00',
  catalog: [
    {
      id: 'sku_rice',
      parent_id: null,
      kind: 'SKU',
      name: '大米',
      revision: 3,
      attributes: [
        {
          template_id: 'product',
          template_version: 2,
          values: { brand: '稻香', specification: '5 kg' },
        },
      ],
    },
  ],
  items: [
    {
      id: 'item_rice_1',
      parent_id: null,
      catalog_node_id: 'sku_rice',
      display_name: null,
      revision: 2,
      attributes: [
        {
          template_id: 'lifecycle',
          template_version: 1,
          values: { state: 'ACTIVE', expiry: { date: '2026-12-01' } },
        },
        {
          template_id: 'contents',
          template_version: 1,
          values: { remaining: { value: '500', unit: 'g' }, accuracy: 'MEASURED' },
        },
      ],
      created_at: '2026-10-01T09:00:00+08:00',
    },
  ],
  notes: [
    {
      id: 'note_1',
      item_id: 'item_rice_1',
      title: '开封',
      body: '今天开封，米香很足。',
      updated_at: '2026-10-30T18:00:00+08:00',
    },
    {
      id: 'note_2',
      item_id: 'item_rice_1',
      title: '长笔记',
      body: '正'.repeat(200),
      updated_at: '2026-10-29T18:00:00+08:00',
    },
  ],
  groups: [
    {
      id: 'sku_rice',
      name: '大米',
      item_ids: ['item_rice_1'],
      count: 1,
      current_count: 1,
      opened: 0,
      sealed: 1,
      unknown_opening: 0,
      unknown_lifecycle: 0,
      locations: 1,
      totals: [{ unit: 'g', value: '500', estimated: false, unknown_accuracy: false }],
      unknown_quantity: 0,
    },
  ],
};

const v2Date = {
  key: 'lifecycle.expiry',
  source: 'LIFECYCLE' as const,
  kind: 'EXPIRY' as const,
  due_on: '2026-11-15',
  basis: 'lifecycle.expiry.date',
  state: 'UPCOMING' as const,
  completed_on: null,
  label: '保质期',
};

const v2Catalog: CatalogRecordV2 = {
  id: 'sku_coffee',
  parent_id: null,
  kind: 'SKU',
  name: '咖啡豆',
  revision: 4,
  profile: 'CONSUMABLE',
  capabilities: null,
  effective_capabilities: ['lifecycle.expiry', 'stock'],
  one_off: false,
  record_state: 'VALID',
  voided_at: null,
  attributes: [
    {
      template_id: 'product',
      template_version: 2,
      values: { brand: '山间' },
      status: 'KNOWN',
    },
    {
      template_id: 'retired_template',
      template_version: 9,
      values: { legacy: true },
      status: 'UNKNOWN',
    },
  ],
  created_at: '2026-09-01T10:00:00+08:00',
  updated_at: '2026-10-01T10:00:00+08:00',
  redacted_paths: [],
};

const v2Snapshot: SnapshotV2 = {
  protocol: 2,
  household,
  as_of_change_id: '42',
  server_time: '2026-10-31T12:00:00+08:00',
  cached_at: '2026-10-31T12:00:01+08:00',
  catalog: [v2Catalog],
  items: [
    {
      id: 'item_coffee_1',
      parent_id: null,
      catalog_node_id: 'sku_coffee',
      display_name: '手冲豆',
      revision: 5,
      record_state: 'VALID',
      voided_at: null,
      effective_capabilities: ['lifecycle.expiry', 'stock'],
      attributes: [
        {
          template_id: 'lifecycle',
          template_version: 1,
          values: { state: 'ACTIVE', expiry: { date: '2026-11-15' } },
          status: 'KNOWN',
        },
      ],
      created_at: '2026-09-01T10:00:00+08:00',
      updated_at: '2026-10-31T09:00:00+08:00',
      note_count: 3,
      attachment_count: 2,
      next_date: v2Date,
      split: null,
      redacted_paths: [],
    },
  ],
  groups: [
    {
      id: 'sku_coffee',
      name: '咖啡豆',
      profile: 'CONSUMABLE',
      count: 1,
      current_count: 1,
      opened: 0,
      sealed: 0,
      unknown_opening: 1,
      unknown_lifecycle: 0,
      locations: 1,
      totals: [],
      unknown_quantity: 0,
      next_date: v2Date,
      overdue_count: 0,
      low_stock: null,
    },
  ],
};

describe('snapshot adapters', () => {
  it('adapts a v1 snapshot with note counts and keeps note bodies out of list facts', () => {
    const view = adaptSnapshot(v1Snapshot, new Date('2026-10-31T12:00:00+08:00'));
    const item = view.items[0];

    expect(item.noteCount).toBe(2);
    expect(item.attachmentCount).toBe(0);
    expect(item.name).toBe('大米');
    expect(item.status).toEqual({ label: '在库', tone: 'success' });
    expect(item.voidedAt).toBeNull();
    expect(item.redactedPaths).toEqual([]);
    expect(JSON.stringify(item.facts)).not.toContain('米香');
    expect(view.notesByItem['item_rice_1']).toHaveLength(2);
    expect(view.notesByItem['item_rice_1'][0].body).toContain('米香');
    expect(view.notesByItem['item_rice_1'][1].excerpt).toHaveLength(160);
    expect(view.asOfChangeId).toBe('0');
    expect(view.household.timezone).toBe('Asia/Shanghai');
    expect(item.facts.map((fact) => fact.kind)).toEqual(['expiry', 'remaining']);
    expect(view.catalog[0].profile).toBeNull();
    expect(view.catalog[0].effectiveCapabilities).toEqual([]);
    expect(view.catalog[0].attributes[0].status).toBe('KNOWN');
  });

  it('adapts a v2 snapshot with note_count, next_date and server groups', () => {
    const view = adaptSnapshot(v2Snapshot);
    const item = view.items[0];
    const group = view.groups[0];

    expect(view.asOfChangeId).toBe('42');
    expect(item.noteCount).toBe(3);
    expect(item.attachmentCount).toBe(2);
    expect(item.profile).toBe('CONSUMABLE');
    expect(view.notesByItem).toEqual({});
    expect(group.nextDate?.dueOn).toBe('2026-11-15');
    expect(group.hasItemIds).toBe(false);
    expect(group.profile).toBe('CONSUMABLE');
    expect(group.lowStock).toBeNull();
    expect(view.catalog[0].effectiveCapabilities).toEqual(['lifecycle.expiry', 'stock']);
  });
});

describe('detail adapters', () => {
  it('wraps a v1 flat detail and preserves unknown template bindings', () => {
    const view = adaptSnapshot(v1Snapshot);
    const detail = adaptItemDetail(
      {
        id: 'item_rice_1',
        parent_id: null,
        catalog_node_id: 'sku_rice',
        display_name: null,
        revision: 2,
        attributes: [
          {
            template_id: 'lifecycle',
            template_version: 1,
            values: { state: 'ACTIVE', expiry: { date: '2026-12-01' } },
          },
          {
            template_id: 'retired_template',
            template_version: 99,
            values: { legacy: true },
          },
        ],
        created_at: '2026-10-01T09:00:00+08:00',
        updated_at: '2026-10-30T09:00:00+08:00',
        catalog_name: '大米',
        path_ids: ['loc_kitchen', 'item_rice_1'],
        reminder: { date: '2026-12-01', basis: ['lifecycle.expiry.date'] },
        notes: [
          {
            id: 'note_1',
            item_id: 'item_rice_1',
            title: '开封',
            body: '正文保留在详情',
            updated_at: '2026-10-30T18:00:00+08:00',
          },
        ],
      },
      view,
      new Date('2026-10-31T12:00:00+08:00'),
    );

    expect(detail.item.id).toBe('item_rice_1');
    expect(detail.item.name).toBe('大米');
    expect(detail.item.noteCount).toBe(1);
    expect(detail.pathIds).toEqual(['loc_kitchen', 'item_rice_1']);
    expect(detail.notes[0].body).toContain('正文保留');
    expect(detail.dates).toHaveLength(1);
    expect(detail.dates[0].dueOn).toBe('2026-12-01');
    expect(detail.dates[0].state).toBe('UPCOMING');
    expect(detail.attachments).toEqual([]);
    expect(detail.split).toBeNull();
  });

  it('passes a v2 detail wrapper through', () => {
    const view = adaptSnapshot(v2Snapshot);
    const detail: ItemDetailV2 = {
      item: v2Snapshot.items[0],
      path_ids: ['item_coffee_1'],
      dates: [v2Date],
      notes: [
        {
          id: 'note_coffee_1',
          target: { kind: 'ITEM', id: 'item_coffee_1' },
          title: '冲煮',
          excerpt: '92 度，1:15',
          created_by: 'actor_1',
          created_at: '2026-10-20T10:00:00+08:00',
          updated_by: 'actor_1',
          updated_at: '2026-10-20T10:00:00+08:00',
          archived: false,
          sensitivity: 'NORMAL',
        },
      ],
      attachments: [
        {
          id: 'attachment_1',
          target: { kind: 'ITEM', id: 'item_coffee_1' },
          mime_type: 'image/jpeg',
          file_size: 1024,
          width: 800,
          height: 600,
          caption: '包装',
          sort_order: 0,
          sensitivity: 'NORMAL',
          created_at: '2026-10-20T10:00:00+08:00',
          thumbnail_url: '/api/attachments/attachment_1?variant=thumb',
        },
      ],
      split: {
        split_id: 'split_1',
        source_item_id: 'item_coffee_0',
        child_item_ids: ['item_coffee_1'],
        count: 1,
        created_at: '2026-10-20T10:00:00+08:00',
      },
    };

    const adapted = adaptItemDetail(detail, view);

    expect(adapted.item.id).toBe('item_coffee_1');
    expect(adapted.item.noteCount).toBe(3);
    expect(adapted.pathIds).toEqual(['item_coffee_1']);
    expect(adapted.dates[0].dueOn).toBe('2026-11-15');
    expect(adapted.notes[0].body).toBeUndefined();
    expect(adapted.notes[0].excerpt).toBe('92 度，1:15');
    expect(adapted.attachments[0].targetKind).toBe('ITEM');
    expect(adapted.attachments[0].thumbnailUrl).toContain('variant=thumb');
    expect(adapted.split?.split_id).toBe('split_1');
  });
});

describe('group adapters', () => {
  it('does not expose v1 item_ids and reports hasItemIds', () => {
    const group = adaptGroup(v1Snapshot.groups[0]);

    expect('item_ids' in group).toBe(false);
    expect(group.hasItemIds).toBe(true);
    expect(group.profile).toBeNull();
    expect(group.nextDate).toBeNull();
    expect(group.overdueCount).toBeNull();
    expect(group.lowStock).toBeNull();
    expect(group.totals[0].unknownAccuracy).toBe(false);
  });

  it('marks v2 groups as without item ids', () => {
    const group = adaptGroup(v2Snapshot.groups[0]);

    expect(group.hasItemIds).toBe(false);
    expect(group.nextDate?.key).toBe('lifecycle.expiry');
  });
});

describe('date adapters', () => {
  it('compares YYYY-MM-DD in the household timezone without UTC shifting', () => {
    const now = new Date('2026-11-01T00:30:00+08:00');

    expect(dateState('2026-10-31', 'Asia/Shanghai', now)).toBe('OVERDUE');
    expect(dateState('2026-11-01', 'Asia/Shanghai', now)).toBe('DUE');
    expect(dateState('2026-11-02', 'Asia/Shanghai', now)).toBe('UPCOMING');
    expect(dateState('2026-11-01', 'America/Los_Angeles', now)).toBe('UPCOMING');
    expect(dateState('not-a-date', 'Asia/Shanghai', now)).toBe('UNKNOWN');
  });

  it('keeps the recorded reminder date verbatim', () => {
    const facts = reminderToFacts(
      { date: '2026-10-31', basis: ['lifecycle.expiry.date'] },
      'Asia/Shanghai',
      new Date('2026-11-01T00:30:00+08:00'),
    );

    expect(facts).toHaveLength(1);
    expect(facts[0].dueOn).toBe('2026-10-31');
    expect(facts[0].state).toBe('OVERDUE');
    expect(facts[0].key).toBe('lifecycle.expiry');
  });
});

describe('template adapters', () => {
  it('derives fields from legacy paths without throwing on unknown schema paths', () => {
    const template = adaptTemplateDefinition({
      id: 'mystery',
      version: 3,
      name: '未知模板',
      target_kind: 'ITEM',
      allowed_catalog_node_kinds: [],
      paths: ['foo', 'bar.baz', 'net_content', 'missing.path'],
      schema: {
        type: 'object',
        properties: {
          foo: { type: 'string' },
          bar: { type: 'object', properties: { baz: { type: 'integer' } } },
          net_content: {
            type: 'object',
            properties: { value: { type: 'string' }, unit: { type: 'string' } },
          },
        },
      },
    });

    expect(template.fields.map((field) => field.path)).toEqual([
      'foo',
      'bar.baz',
      'net_content',
      'missing.path',
    ]);
    expect(template.fields[1].label).toBe('baz');
    expect(template.fields[1].type).toBe('number');
    expect(template.fields[2].type).toBe('measurement');
    expect(template.fields[3].type).toBe('string');
    expect(template.fields.map((field) => field.order)).toEqual([0, 1, 2, 3]);
    expect(template.fields[0].section).toBe('资料');
  });

  it('uses v2 fields when they are present', () => {
    const template = adaptTemplateDefinition({
      id: 'mystery',
      version: 4,
      name: '未知模板',
      target_kind: 'ITEM',
      allowed_catalog_node_kinds: [],
      paths: ['foo'],
      fields: [{ path: 'foo', label: '自定义标签', type: 'string', section: '其他', order: 7 }],
    });

    expect(template.fields[0].label).toBe('自定义标签');
    expect(template.fields[0].order).toBe(7);
  });
});

describe('capability adapters', () => {
  it('returns no capabilities when the server did not resolve them', () => {
    expect(effectiveCapabilities({ metadata: { profile: 'CONSUMABLE' } })).toEqual([]);
    expect(effectiveCapabilities({ effective_capabilities: [] })).toEqual([]);
    expect(effectiveCapabilities({ effective_capabilities: ['stock'] })).toEqual(['stock']);
    expect(
      effectiveCapabilities({
        metadata: { effective_capabilities: ['stock', 7, 'deadline'] },
      }),
    ).toEqual(['stock', 'deadline']);
  });

  it('does not replicate profile defaults or capabilities that are still inherited', () => {
    const catalog = adaptCatalog({
      ...v2Catalog,
      capabilities: null,
      effective_capabilities: [],
    });

    expect(catalog.profile).toBe('CONSUMABLE');
    expect(catalog.capabilities).toBeNull();
    expect(catalog.effectiveCapabilities).toEqual([]);
    expect(hasCapability(catalog, 'stock')).toBe(false);
    expect(hasCapability({ capabilities: null }, 'stock')).toBe(false);
    expect(hasCapability({ capabilities: ['stock'] }, 'stock')).toBe(true);
  });
});
