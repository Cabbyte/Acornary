import {
  ancestors,
  attr,
  isContainer,
  isTerminal,
  itemName,
  type InventoryData,
  type ItemRecord,
} from '../../../../packages/contracts/src/web.js';
import { searchInventory } from './browse.js';
import { label } from './presentation.js';

export const WORKBENCH_PAGE_SIZE = 20;
export type WorkbenchFilter = {
  query: string;
  descendants: boolean;
  status: string;
  category: string;
  sort: string;
};
export const availabilityOptions = [
  ['', '未记录'],
  ['IN_USE', '使用中'],
  ['AVAILABLE', '可用'],
  ['LOANED', '已借出'],
  ['CLEANING', '清洗中'],
  ['MAINTENANCE', '维护中'],
  ['IN_TRANSIT', '运输中'],
] as const;
export function itemStatus(item: ItemRecord) {
  const life = attr(item, 'lifecycle');
  return label(isTerminal(item) ? life?.state : life?.availability);
}
export function workbenchItems(
  data: InventoryData,
  place: string | undefined,
  filter: WorkbenchFilter,
) {
  return searchInventory(
    data,
    filter.query,
    place,
    filter.status === 'terminal' ? 'terminal' : 'current',
    filter.category,
  )
    .filter((i) => !isContainer(i) && (!place || filter.descendants || i.parent_id === place))
    .filter(
      (i) =>
        !filter.status ||
        filter.status === 'terminal' ||
        (filter.status === 'unknown'
          ? !attr(i, 'lifecycle')?.availability
          : attr(i, 'lifecycle')?.availability === filter.status),
    )
    .sort(
      (a, b) =>
        (filter.sort === 'recent'
          ? b.created_at.localeCompare(a.created_at)
          : itemName(a, data).localeCompare(itemName(b, data), 'zh-CN')) ||
        a.id.localeCompare(b.id),
    );
}
export function moveTargets(data: InventoryData, selected: ItemRecord[]) {
  const ids = new Set(selected.map((i) => i.id));
  return data.items.filter(
    (i) =>
      isContainer(i) && !isTerminal(i) && !ancestors(i.id, data.items).some((a) => ids.has(a.id)),
  );
}
export function moveValidation(data: InventoryData, selected: ItemRecord[], parent: string) {
  if (!selected.length || selected.length > 100) return '请选择 1–100 件物品。';
  if (parent && !moveTargets(data, selected).some((i) => i.id === parent))
    return '请选择可用的目标位置。';
  if (selected.every((i) => (i.parent_id ?? '') === parent)) return '所选物品已在这个位置。';
  return '';
}
export function latestNote(data: InventoryData, id: string) {
  return data.notes
    .filter((n) => n.item_id === id)
    .sort((a, b) => b.updated_at.localeCompare(a.updated_at) || a.id.localeCompare(b.id))[0];
}
