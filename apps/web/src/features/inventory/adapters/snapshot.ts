import type {
  CatalogRecordV2,
  NoteSummaryV2,
  NoteV2,
  ProductGroupV2,
  SnapshotV2,
  ItemRecordV2,
} from '../../../../../../packages/contracts/src/read-v2.js';
import type {
  CatalogRecord,
  InventorySnapshot,
  ItemRecord,
  NoteRecord,
  ProductGroup,
} from '../../../../../../packages/contracts/src/web.js';
import type { CatalogView, InventoryView, ItemLocationView, NoteView } from '../model/types.js';
import { adaptGroup } from './groups.js';
import { groupNotesByItem } from './notes.js';
import { adaptCatalog, adaptItem } from './record.js';
import { isSnapshotV2 } from './shape.js';

// The v1 contract marks timezone optional; installations default to Asia/Shanghai.
const DEFAULT_TIMEZONE = 'Asia/Shanghai';

type ItemSource = ItemRecordV2 | ItemRecord;
type NoteSource = NoteRecord | NoteSummaryV2 | NoteV2;

const textValue = (value: unknown): string | undefined =>
  typeof value === 'string' && value.length > 0 ? value : undefined;

export function toNoteMap(
  notes: readonly NoteSource[] | null | undefined,
): Record<string, NoteView[]> {
  return Array.isArray(notes) ? groupNotesByItem(notes) : {};
}

const itemName = (item: ItemSource, catalogById: ReadonlyMap<string, CatalogView>): string =>
  textValue(item.display_name) ?? catalogById.get(item.catalog_node_id)?.name ?? '未命名物品';

const resolveLocation = (
  item: ItemSource,
  itemsById: ReadonlyMap<string, ItemSource>,
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

export function adaptSnapshot(
  raw: SnapshotV2 | InventorySnapshot,
  now: Date = new Date(),
): InventoryView {
  const isV2 = isSnapshotV2(raw) || (raw as { protocol?: unknown }).protocol === 2;
  const catalogSource = (Array.isArray(raw.catalog) ? raw.catalog : []) as (
    CatalogRecordV2 | CatalogRecord
  )[];
  const catalog = catalogSource.map(adaptCatalog);
  const catalogById = new Map(catalog.map((record) => [record.id, record]));
  const notesByItem: Record<string, NoteView[]> = isV2
    ? {}
    : toNoteMap((raw as InventorySnapshot).notes);
  const itemSource = (Array.isArray(raw.items) ? raw.items : []) as ItemSource[];
  const itemsById = new Map(itemSource.map((item) => [item.id, item]));
  const items = itemSource.map((item) =>
    adaptItem(item, notesByItem[item.id] ?? [], {
      catalogName: catalogById.get(item.catalog_node_id)?.name,
      profile: catalogById.get(item.catalog_node_id)?.profile ?? null,
      location: resolveLocation(item, itemsById, catalogById),
    }),
  );
  const groupSource = (Array.isArray(raw.groups) ? raw.groups : []) as (
    ProductGroupV2 | ProductGroup
  )[];
  return {
    household: {
      id: raw.household.id,
      name: raw.household.name,
      timezone: raw.household.timezone ?? DEFAULT_TIMEZONE,
    },
    asOfChangeId: isV2 ? ((raw as SnapshotV2).as_of_change_id ?? '0') : '0',
    catalog,
    items,
    groups: groupSource.map(adaptGroup),
    notesByItem,
    capabilities: {},
    cachedAt: raw.cached_at,
  };
}
