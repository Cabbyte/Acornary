import { z } from 'zod';
import { entityId } from './ids.js';

export const changeId = z
  .string()
  .regex(/^(0|[1-9]\d*)$/)
  .refine((v) => BigInt(v) <= 9223372036854775807n);
export const syncKind = z.enum(['ITEM', 'CATALOG_NODE', 'NOTE', 'ATTACHMENT']);
const limit = z.coerce.number().int().min(1).max(200).default(100);
export const syncChangesQuery = z.strictObject({
  generation: z.uuid(),
  cursor: changeId,
  limit,
  // Pin subsequent pages to the first page's household high watermark.
  as_of_change_id: changeId.optional(),
});
export const syncBootstrapQuery = z.strictObject({
  cursor: z.string().max(8192).optional(),
  limit,
});
export const syncFetchRequest = z.strictObject({
  generation: z.uuid(),
  ids: z
    .array(
      z.discriminatedUnion('kind', [
        z.strictObject({ kind: z.literal('ITEM'), id: entityId('item') }),
        z.strictObject({ kind: z.literal('CATALOG_NODE'), id: entityId('catalog_node') }),
        z.strictObject({ kind: z.literal('NOTE'), id: entityId('note') }),
        z.strictObject({
          kind: z.literal('ATTACHMENT'),
          id: z.string().regex(/^attachment_[0-9a-f-]{36}$/),
        }),
      ]),
    )
    .max(200),
});
export type SyncState = {
  generation: string;
  last_change_id: string;
  min_available_change_id: string;
  protocol: 2;
};
export type SyncChange = {
  change_id: string;
  object_kind: z.infer<typeof syncKind>;
  object_id: string;
  revision: number;
  change_kind: 'UPSERT' | 'TOMBSTONE';
};
export type SyncChanges = {
  generation: string;
  changes: SyncChange[];
  next_cursor: string | null;
  has_more: boolean;
  as_of_change_id: string;
};
export type AttributeBinding = {
  template_id: string;
  template_version: number;
  values: Record<string, unknown>;
  status: 'KNOWN' | 'UNKNOWN' | 'RETIRED';
};
export type Profile = 'CONSUMABLE' | 'DURABLE' | 'WEARABLE' | 'SPACE' | 'MISC';
// Date/split producers land in their own lanes. Until then these projections are null.
export type CatalogRecord = {
  id: string;
  parent_id: string | null;
  kind: 'GROUP' | 'SKU';
  name: string;
  revision: number;
  profile: Profile | null;
  capabilities: string[] | null;
  effective_capabilities: string[];
  one_off: boolean;
  record_state: 'VALID' | 'VOID';
  voided_at: string | null;
  attributes: AttributeBinding[];
  created_at: string;
  updated_at: string;
  redacted_paths: string[];
  last_change_id: string;
};
export type ItemRecord = {
  id: string;
  parent_id: string | null;
  catalog_node_id: string;
  display_name: string | null;
  revision: number;
  record_state: 'VALID' | 'VOID';
  voided_at: string | null;
  effective_capabilities: string[];
  attributes: AttributeBinding[];
  created_at: string;
  updated_at: string;
  note_count: number;
  attachment_count: number;
  next_date: null;
  split: null;
  redacted_paths: string[];
  last_change_id: string;
};
export type ProductGroup = {
  id: string;
  name: string;
  profile: Profile | null;
  count: number;
  current_count: number;
  opened: number;
  sealed: number;
  unknown_opening: number;
  unknown_lifecycle: number;
  locations: number;
  totals: { unit: string; value: string; estimated: boolean; unknown_accuracy: boolean }[];
  unknown_quantity: number;
  next_date: null;
  overdue_count: number;
  low_stock: boolean | null;
};
export type InventoryGroupsResult = {
  groups: ProductGroup[];
  matching_group_count: number;
  as_of_change_id: string;
  stale: boolean;
  next_cursor?: string | null;
};
export type SnapshotV2 = {
  protocol: 2;
  household: { id: string; name: string; timezone: string };
  as_of_change_id: string;
  server_time: string;
  catalog: CatalogRecord[];
  items: ItemRecord[];
  groups: ProductGroup[];
  cached_at: string;
};
export type SyncBootstrap = Pick<SnapshotV2, 'catalog' | 'items' | 'groups' | 'as_of_change_id'> & {
  generation: string;
  next_cursor: string | null;
  has_more: boolean;
};
export type NoteSummary = {
  id: string;
  target: { kind: 'ITEM'; id: string };
  title: string | null;
  excerpt: string;
  archived: boolean;
  sensitivity: 'NORMAL' | 'SENSITIVE' | 'SECRET';
  created_by: string;
  updated_by: string;
  created_at: string;
  updated_at: string;
  last_change_id: string;
};
export type SyncFetchResult = {
  generation: string;
  objects: (ItemRecord | CatalogRecord | NoteSummary)[];
  groups: ProductGroup[];
};
