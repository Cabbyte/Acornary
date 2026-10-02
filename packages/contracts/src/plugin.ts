import { z } from 'zod';
import { entityId } from './ids.js';
import { templates, schemas, reads, type Operation } from './index.js';
import { productGroups, inventoryFilterSchema } from './web.js';

const attribute = z.object({
  template_id: z.enum(
    Object.keys(templates) as [keyof typeof templates, ...(keyof typeof templates)[]],
  ),
  template_version: z.literal(1),
  values: z.record(z.string(), z.unknown()),
});
const record = {
  id: z.union([entityId('item'), entityId('catalog_node')]),
  parent_id: z.union([entityId('item'), entityId('catalog_node')]).nullable(),
  revision: z.number().int().positive(),
  attributes: z.array(attribute),
};
const snapshot = z
  .object({
    household: z.object({ id: z.string().min(1), name: z.string() }),
    container_catalog_id: z.string(),
    catalog: z.array(z.object({ ...record, kind: z.enum(['GROUP', 'SKU']), name: z.string() })),
    items: z.array(
      z.object({
        ...record,
        catalog_node_id: entityId('catalog_node'),
        display_name: z.string().nullable(),
        created_at: z.string(),
      }),
    ),
    notes: z.array(
      z.object({
        id: entityId('note'),
        item_id: entityId('item'),
        title: z.string().nullable(),
        body: z.string(),
        updated_at: z.string(),
      }),
    ),
    cached_at: z.string(),
  })
  .transform((data) => ({ ...data, groups: productGroups(data, inventoryFilterSchema.parse({})) }));

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
  note_id: entityId('note').optional(),
  summary: z.string(),
});
