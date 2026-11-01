import { z } from 'zod';
import { entityId } from './ids.js';
import { schemas, reads, type Operation } from './index.js';
import type { SnapshotV2 } from './read-v2.js';

const capability = z.enum([
  'lifecycle.expiry',
  'lifecycle.opening',
  'contents',
  'stock',
  'asset',
  'custody',
  'service',
  'deadline',
  'clothing',
  'wardrobe',
  'container',
  'usage',
  'transport',
]);
const profile = z.enum(['CONSUMABLE', 'DURABLE', 'WEARABLE', 'SPACE', 'MISC']).nullable();
const attribute = z.object({
  template_id: z.string().min(1),
  template_version: z.number().int().positive(),
  values: z.record(z.string(), z.unknown()),
  status: z.enum(['KNOWN', 'UNKNOWN', 'RETIRED']),
});
const record = {
  id: z.union([entityId('item'), entityId('catalog_node')]),
  parent_id: z.union([entityId('item'), entityId('catalog_node')]).nullable(),
  revision: z.number().int().positive(),
  attributes: z.array(attribute),
  effective_capabilities: z.array(capability),
  record_state: z.enum(['VALID', 'VOID']),
  voided_at: z.string().nullable(),
  created_at: z.string(),
  updated_at: z.string(),
  redacted_paths: z.array(z.string()),
};
const dateFact = z.object({
  key: z.string(),
  source: z.enum(['LIFECYCLE', 'DEADLINE']),
  kind: z.enum(['EXPIRY', 'WARRANTY_END', 'SERVICE_DUE', 'RETURN_BY', 'RENEWAL', 'REORDER_BY']),
  date_kind: z.enum(['BEST_BEFORE', 'USE_BY', 'ESTIMATED']).optional(),
  due_on: z.string(),
  basis: z.string().nullable(),
  state: z.enum(['UPCOMING', 'DUE', 'OVERDUE', 'COMPLETED', 'UNKNOWN']),
  completed_on: z.string().nullable(),
  label: z.string(),
});
const snapshot = z
  .object({
    protocol: z.literal(2),
    household: z.object({ id: z.string().min(1), name: z.string(), timezone: z.string() }),
    container_catalog_id: z.string().nullable(),
    as_of_change_id: z.string(),
    server_time: z.string(),
    catalog: z.array(
      z.object({
        ...record,
        kind: z.enum(['GROUP', 'SKU']),
        name: z.string(),
        profile,
        capabilities: z.array(capability).nullable(),
        one_off: z.boolean(),
      }),
    ),
    items: z.array(
      z.object({
        ...record,
        catalog_node_id: entityId('catalog_node'),
        display_name: z.string().nullable(),
        note_count: z.number().int().nonnegative(),
        attachment_count: z.number().int().nonnegative(),
        next_date: dateFact.nullable(),
        split: z
          .object({
            split_id: z.string(),
            source_item_id: z.string(),
            child_item_ids: z.array(z.string()),
            count: z.number().int(),
            created_at: z.string(),
          })
          .nullable(),
      }),
    ),
    groups: z.array(
      z.object({
        id: z.string(),
        name: z.string(),
        profile,
        count: z.number(),
        current_count: z.number(),
        opened: z.number(),
        sealed: z.number(),
        unknown_opening: z.number(),
        unknown_lifecycle: z.number(),
        locations: z.number(),
        totals: z.array(
          z.object({
            unit: z.string(),
            value: z.string(),
            estimated: z.boolean(),
            unknown_accuracy: z.boolean(),
          }),
        ),
        unknown_quantity: z.number(),
        next_date: dateFact.nullable(),
        overdue_count: z.number(),
        low_stock: z.boolean().nullable(),
      }),
    ),
    cached_at: z.string(),
  })
  .transform((data): SnapshotV2 => data);

export const pluginEnvelopeSchema = z
  .object({
    version: z.literal(1),
    session: z.object({
      mode: z.enum(['local', 'cloud']),
      authenticated: z.literal(true),
      cache_key: z.string().min(1),
      household_id: z.string().min(1),
      user_id: z.string().optional(),
      can_write: z.boolean(),
      host: z.literal('mcp'),
    }),
    snapshot,
  })
  .refine(
    (value) => value.session.household_id === value.snapshot.household.id,
    'Household mismatch',
  );
export type PluginEnvelope = z.infer<typeof pluginEnvelopeSchema>;
export const pluginMetaKey = 'acornary/view';
export const pluginViewTool = 'get_inventory_view';
export const pluginOpenTool = 'open_inventory';
export const pluginReviewTool = 'get_catalog_review';
export const pluginConfirmTool = 'confirm_catalog_change';
export const pluginReviewMetaKey = 'acornary/catalog-review';
export const pluginWriteTool = 'apply_inventory_command';
export const pluginWriteSchema = z.strictObject({
  expected_scope: z.string().regex(/^mcp:[a-f0-9]{64}$/),
  operation: z.enum(
    (Object.keys(schemas) as Operation[]).filter((name) => !reads.has(name)) as [
      Operation,
      ...Operation[],
    ],
  ),
  input: z.record(z.string(), z.unknown()),
});
export const pluginWriteResultSchema = z.strictObject({
  operation_id: entityId('operation'),
  changed: z.boolean(),
  affected_objects: z.array(
    z.strictObject({
      kind: z.enum(['ITEM', 'CATALOG_NODE']),
      id: z.union([entityId('item'), entityId('catalog_node')]),
      before_revision: z.number().int().nonnegative(),
      after_revision: z.number().int().positive(),
    }),
  ),
  event_ids: z.array(entityId('event')),
  created_items: z
    .array(
      z.strictObject({
        client_ref: z.string(),
        item_id: entityId('item'),
        after_revision: z.number().int().positive(),
      }),
    )
    .optional(),
  note_id: entityId('note').optional(),
  proposal_id: z.uuid().optional(),
  receipt: z.record(z.string(), z.unknown()).optional(),
  summary: z.string(),
});
