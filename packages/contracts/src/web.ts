import { Decimal } from 'decimal.js';
import { z } from 'zod';
import { templates, type TemplateId } from './index.js';

export interface Attribute {
  template_id: TemplateId;
  template_version: 1;
  values: Record<string, unknown>;
}
export interface CatalogRecord {
  id: string;
  parent_id: string | null;
  kind: 'GROUP' | 'SKU';
  name: string;
  revision: number;
  attributes: Attribute[];
}
export interface ItemRecord {
  id: string;
  parent_id: string | null;
  catalog_node_id: string;
  display_name: string | null;
  revision: number;
  attributes: Attribute[];
  created_at: string;
}
export interface NoteRecord {
  id: string;
  item_id: string;
  title: string | null;
  body: string;
  updated_at: string;
}
export interface InventoryData {
  household: { id: string; name: string };
  container_catalog_id: string;
  catalog: CatalogRecord[];
  items: ItemRecord[];
  notes: NoteRecord[];
  cached_at: string;
}
export const inventoryFilterSchema = z.strictObject({
  search: z.string().max(500).default(''),
  location: z.string().max(100).default(''),
  category: z.string().max(100).default(''),
  state: z.enum(['current', 'all', 'OPENED', 'SEALED', 'unknown', 'terminal']).default('current'),
});
export type InventoryFilter = z.infer<typeof inventoryFilterSchema>;
export interface ProductGroup {
  id: string;
  name: string;
  item_ids: string[];
  count: number;
  current_count: number;
  opened: number;
  sealed: number;
  unknown_opening: number;
  unknown_lifecycle: number;
  locations: number;
  totals: { unit: string; value: string; estimated: boolean; unknown_accuracy: boolean }[];
  unknown_quantity: number;
}
export interface InventorySnapshot extends InventoryData {
  groups: ProductGroup[];
}
export interface WriteResult {
  operation_id: string;
  changed: boolean;
  event_ids: string[];
  note_id?: string;
  affected_objects: {
    kind: 'ITEM' | 'CATALOG_NODE';
    id: string;
    before_revision: number;
    after_revision: number;
  }[];
}
export interface HistoryEvent {
  id: string;
  event_type: string;
  occurred_at: string;
  recorded_at: string;
  reason?: string;
  changes: { path: string; before?: unknown; after?: unknown }[];
}
export function attr<K extends TemplateId>(
  record: { attributes: Attribute[] },
  key: K,
): z.infer<(typeof templates)[K]['schema']> | undefined {
  return record.attributes.find((a) => a.template_id === key)?.values as
    z.infer<(typeof templates)[K]['schema']> | undefined;
}
export const isTerminal = (item: ItemRecord) =>
  ['CONSUMED', 'DISPOSED', 'LOST', 'ARCHIVED'].includes(attr(item, 'lifecycle')?.state ?? '');
export const isContainer = (item: ItemRecord) => attr(item, 'container')?.can_contain === true;
export function ancestors<T extends { id: string; parent_id: string | null }>(
  id: string | null,
  records: T[],
): T[] {
  const byId = new Map(records.map((r) => [r.id, r]));
  const path: T[] = [];
  const seen = new Set<string>();
  while (id && !seen.has(id)) {
    seen.add(id);
    const record = byId.get(id);
    if (!record) break;
    path.unshift(record);
    id = record.parent_id;
  }
  return path;
}
export const itemName = (item: ItemRecord, data: InventoryData) =>
  item.display_name ||
  data.catalog.find((c) => c.id === item.catalog_node_id)?.name ||
  '未命名物品';
export const locationName = (item: Pick<ItemRecord, 'parent_id'>, data: InventoryData) =>
  ancestors(item.parent_id, data.items)
    .map((i) => itemName(i, data))
    .join(' / ') || '未记录位置';
// Run over the complete read model, before any UI paging. The same projection is used offline.
export function productGroups(data: InventoryData, filter: InventoryFilter): ProductGroup[] {
  const catalog = new Map(data.catalog.map((c) => [c.id, c]));
  const groups = new Map<string, ProductGroup>();
  const locations = new Map<string, Set<string>>();
  for (const item of data.items) {
    if (isContainer(item) || item.catalog_node_id === data.container_catalog_id) continue;
    const sku = catalog.get(item.catalog_node_id);
    if (!sku) continue;
    const life = attr(item, 'lifecycle');
    const terminal = isTerminal(item);
    if (filter.state !== 'all' && (filter.state === 'terminal' ? !terminal : terminal)) continue;
    if (['OPENED', 'SEALED'].includes(filter.state) && life?.opening?.state !== filter.state)
      continue;
    if (filter.state === 'unknown' && life?.opening?.state) continue;
    if (
      filter.location &&
      !ancestors(item.parent_id, data.items).some((i) => i.id === filter.location)
    )
      continue;
    if (filter.category && !ancestors(sku.id, data.catalog).some((c) => c.id === filter.category))
      continue;
    const product = attr(sku, 'product');
    if (
      filter.search &&
      ![sku.name, item.display_name, product?.brand, product?.model]
        .filter(Boolean)
        .join(' ')
        .toLocaleLowerCase()
        .includes(filter.search.trim().toLocaleLowerCase())
    )
      continue;
    let group = groups.get(sku.id);
    if (!group) {
      group = {
        id: sku.id,
        name: sku.name,
        item_ids: [],
        count: 0,
        current_count: 0,
        opened: 0,
        sealed: 0,
        unknown_opening: 0,
        unknown_lifecycle: 0,
        locations: 0,
        totals: [],
        unknown_quantity: 0,
      };
      groups.set(sku.id, group);
      locations.set(sku.id, new Set());
    }
    group.item_ids.push(item.id);
    group.count++;
    locations.get(sku.id)!.add(item.parent_id ?? '');
    group.locations = locations.get(sku.id)!.size;
    if (terminal) continue;
    group.current_count++;
    if (!life?.state) group.unknown_lifecycle++;
    if (life?.opening?.state === 'OPENED') group.opened++;
    else if (life?.opening?.state === 'SEALED') group.sealed++;
    else group.unknown_opening++;
    const contents = attr(item, 'contents');
    const remaining = contents?.remaining;
    // Percentages refer to independent items; never add them together or infer SKU capacity.
    if (!remaining || remaining.unit === 'percent') {
      group.unknown_quantity++;
      continue;
    }
    let total = group.totals.find((t) => t.unit === remaining.unit);
    if (!total) {
      total = { unit: remaining.unit, value: '0', estimated: false, unknown_accuracy: false };
      group.totals.push(total);
    }
    total.value = new Decimal(total.value).plus(remaining.value).toFixed();
    total.estimated ||= contents?.accuracy === 'ESTIMATED';
    total.unknown_accuracy ||= !contents?.accuracy;
  }
  return [...groups.values()];
}
