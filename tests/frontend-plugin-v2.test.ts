import { describe, expect, it } from 'vitest';
import { pluginEnvelopeSchema } from '../packages/contracts/src/plugin.js';
import { resolveFeatures } from '../apps/web/src/features/api/features.js';
import { adaptItemDetail } from '../apps/web/src/features/inventory/adapters/detail.js';
import { adaptSnapshot } from '../apps/web/src/features/inventory/adapters/snapshot.js';
import type { ConnectionContext, SnapshotV2 } from '../packages/contracts/src/read-v2.js';

const household = {
  id: 'household_11111111-1111-4111-8111-111111111111',
  name: '家',
  timezone: 'Asia/Shanghai',
};
const catalogId = 'catalog_node_11111111-1111-4111-8111-111111111111';
const itemId = 'item_11111111-1111-4111-8111-111111111111';
const timestamp = '2026-10-31T12:00:00Z';
const record = {
  parent_id: null,
  revision: 3,
  attributes: [
    {
      template_id: 'future_template',
      template_version: 9,
      values: { future: true },
      status: 'UNKNOWN' as const,
    },
  ],
  effective_capabilities: ['stock' as const],
  record_state: 'VALID' as const,
  voided_at: null,
  created_at: timestamp,
  updated_at: timestamp,
  redacted_paths: ['attributes.private'],
};
const snapshot: SnapshotV2 = {
  protocol: 2,
  household,
  container_catalog_id: null,
  as_of_change_id: '42',
  server_time: timestamp,
  cached_at: timestamp,
  catalog: [
    {
      ...record,
      id: catalogId,
      kind: 'SKU',
      name: '咖啡豆',
      profile: 'CONSUMABLE',
      capabilities: null,
      one_off: false,
    },
  ],
  items: [
    {
      ...record,
      id: itemId,
      catalog_node_id: catalogId,
      display_name: null,
      note_count: 3,
      attachment_count: 2,
      next_date: null,
      split: {
        split_id: 'split_1',
        source_item_id: itemId,
        child_item_ids: [],
        count: 1,
        created_at: timestamp,
      },
    },
  ],
  groups: [
    {
      id: catalogId,
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
      unknown_quantity: 1,
      next_date: null,
      overdue_count: 0,
      low_stock: true,
    },
  ],
};
const envelope = (snapshot: unknown) => ({
  version: 2,
  protocol: 2,
  session: {
    mode: 'local',
    authenticated: true,
    cache_key: 'local:test',
    household_id: household.id,
    can_write: true,
    host: 'mcp',
  },
  snapshot,
});

describe('plugin envelope v2 snapshot', () => {
  it('preserves v2 metadata, unknown bindings and server groups without adding note bodies', () => {
    const parsed = pluginEnvelopeSchema.parse(envelope(snapshot));
    expect(parsed.snapshot).toEqual(snapshot);
    expect(parsed.snapshot).not.toHaveProperty('notes');
    expect(parsed.snapshot.container_catalog_id).toBeNull();
    expect(parsed.snapshot.groups[0]).not.toHaveProperty('item_ids');
  });

  it('rejects v1 snapshots instead of adapting notes or deriving groups', () => {
    expect(
      pluginEnvelopeSchema.safeParse(
        envelope({
          household,
          container_catalog_id: '',
          catalog: [],
          items: [],
          notes: [],
          cached_at: timestamp,
        }),
      ).success,
    ).toBe(false);
  });

  it.each(['container_catalog_id', 'as_of_change_id', 'server_time', 'groups'])(
    'requires the v2 %s field',
    (field) => {
      expect(
        pluginEnvelopeSchema.safeParse(envelope({ ...snapshot, [field]: undefined })).success,
      ).toBe(false);
    },
  );
});

it('rejects the old envelope even when its snapshot has protocol 2', () => {
  expect(pluginEnvelopeSchema.safeParse({ ...envelope(snapshot), version: 1 }).success).toBe(false);
  expect(
    pluginEnvelopeSchema.safeParse({ ...envelope(snapshot), protocol: undefined }).success,
  ).toBe(false);
});

it('intersects plugin capabilities with advertised features while preserving Web support', () => {
  const context = {
    features: ['stock', 'void', 'split', 'references', 'attachments', 'notes_v2', 'deadline'],
  } as ConnectionContext;
  const plugin = resolveFeatures(context, 'mcp');
  for (const feature of ['stock', 'void', 'split', 'references', 'attachments'] as const) {
    expect(plugin.has(feature)).toBe(false);
    expect(resolveFeatures(context, 'web').has(feature)).toBe(true);
  }
  expect(plugin.has('notes_v2')).toBe(true);
  expect(plugin.has('deadline')).toBe(true);
  expect(resolveFeatures(undefined, 'mcp').has('notes_v2')).toBe(false);
});

it('preserves flat get_item metadata and uses the server derived availability', () => {
  const raw = {
    ...snapshot.items[0],
    record_state: 'VOID',
    voided_at: timestamp,
    notes: [],
    attachments: [],
    path_ids: [itemId],
    dates: [],
  };
  const detail = adaptItemDetail(raw, adaptSnapshot(snapshot));
  expect(detail.item.recordState).toBe('VOID');
  expect(detail.item.voidedAt).toBe(timestamp);
  expect(detail.item.redactedPaths).toEqual(record.redacted_paths);
  expect(detail.item.noteCount).toBe(3);
  expect(detail.split).toEqual(raw.split);
  expect(detail.pathIds).toEqual([itemId]);
  const available = adaptItemDetail(
    { ...raw, record_state: 'VALID', derived_availability: 'UNAVAILABLE' },
    adaptSnapshot(snapshot),
  );
  expect(available.item.status.label).toBe('暂不可用');
});
