import type { ItemRecordV2, SnapshotV2 } from '../../../../../../packages/contracts/src/read-v2.js';
import type { CatalogView, InventoryView, ItemLocationView } from '../model/types.js';
import { adaptGroup } from './groups.js';
import { adaptCatalog, adaptItem } from './record.js';

const textValue = (value: unknown): string | undefined =>
  typeof value === 'string' && value.length > 0 ? value : undefined;

const itemName = (item: ItemRecordV2, catalogById: ReadonlyMap<string, CatalogView>): string =>
  textValue(item.display_name) ?? catalogById.get(item.catalog_node_id)?.name ?? '未命名物品';

const resolveLocation = (
  item: ItemRecordV2,
  itemsById: ReadonlyMap<string, ItemRecordV2>,
  catalogById: ReadonlyMap<string, CatalogView>,
): ItemLocationView => {
  const path: string[] = [];
  const seen = new Set<string>();
  let cursor = item.parent_id;
  while (cursor && !seen.has(cursor)) {
    seen.add(cursor);
    const parent = itemsById.get(cursor);
    if (!parent) break;
    path.unshift(itemName(parent, catalogById));
    cursor = parent.parent_id;
  }
  return {
    id: item.parent_id,
    path,
    label: path.length ? path.join(' / ') : '未记录位置',
  };
};

export function adaptSnapshot(raw: SnapshotV2): InventoryView {
  const catalog = raw.catalog.map(adaptCatalog);
  const catalogById = new Map(catalog.map((record) => [record.id, record]));
  const itemsById = new Map(raw.items.map((item) => [item.id, item]));
  const items = raw.items.map((item) =>
    adaptItem(item, [], {
      catalogName: catalogById.get(item.catalog_node_id)?.name,
      profile: catalogById.get(item.catalog_node_id)?.profile ?? null,
      location: resolveLocation(item, itemsById, catalogById),
    }),
  );
  return {
    household: raw.household,
    asOfChangeId: raw.as_of_change_id,
    catalog,
    items,
    groups: raw.groups.map(adaptGroup),
    notesByItem: {},
    capabilities: {},
    cachedAt: raw.cached_at,
  };
}
