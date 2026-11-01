import { derivedAvailability } from '../../../../packages/contracts/src/semantics.js';
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
import { label, remaining } from './presentation.js';

export const WORKBENCH_PAGE_SIZE = 20;
export type WorkbenchFilter = {
  query: string;
  descendants: boolean;
  status: string;
  category: string;
  sort: string;
  opening?: string;
  condition?: string;
  lifecycle?: string;
};
const availabilityOf = (item: ItemRecord) =>
  derivedAvailability(Object.fromEntries(item.attributes.map((a) => [a.template_id, a.values])));
export function itemStatus(item: ItemRecord) {
  const life = attr(item, 'lifecycle');
  return label(isTerminal(item) ? life?.state : availabilityOf(item));
}
/** Only expose recorded facts; unknown opening must never look like sealed. */
export function itemFacts(item: ItemRecord) {
  const life = attr(item, 'lifecycle');
  return [
    ...(life?.opening?.state ? [label(life.opening.state)] : []),
    ...(attr(item, 'contents')?.remaining ? [`剩余 ${remaining(item)}`] : []),
    ...(life?.expiry?.date ? [`到期 ${life.expiry.date}`] : []),
    ...(isTerminal(item) || availabilityOf(item) ? [itemStatus(item)] : []),
  ].join(' · ');
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
    filter.status === 'terminal' ||
      ['CONSUMED', 'DISPOSED', 'LOST', 'ARCHIVED'].includes(filter.lifecycle ?? '')
      ? 'terminal'
      : 'current',
    filter.category,
  )
    .filter((i) => !isContainer(i) && (!place || filter.descendants || i.parent_id === place))
    .filter(
      (i) =>
        !filter.status ||
        filter.status === 'terminal' ||
        (filter.status === 'unknown' ? !availabilityOf(i) : availabilityOf(i) === filter.status),
    )
    .filter(
      (i) =>
        !filter.opening ||
        (filter.opening === 'unknown'
          ? !attr(i, 'lifecycle')?.opening?.state
          : attr(i, 'lifecycle')?.opening?.state === filter.opening),
    )
    .filter(
      (i) =>
        !filter.condition ||
        (filter.condition === 'unknown'
          ? !attr(i, 'lifecycle')?.condition
          : attr(i, 'lifecycle')?.condition === filter.condition),
    )
    .filter(
      (i) =>
        !filter.lifecycle ||
        (filter.lifecycle === 'unknown'
          ? !attr(i, 'lifecycle')?.state
          : attr(i, 'lifecycle')?.state === filter.lifecycle),
    )
    .sort(
      (a, b) =>
        (filter.sort === 'recent'
          ? b.created_at.localeCompare(a.created_at)
          : itemName(a, data).localeCompare(itemName(b, data), 'zh-CN')) ||
        a.id.localeCompare(b.id),
    );
}
export function moveTargets(data: Pick<InventoryData, 'items'>, selected: ItemRecord[]) {
  const ids = new Set(selected.map((i) => i.id));
  return data.items.filter(
    (i) =>
      isContainer(i) && !isTerminal(i) && !ancestors(i.id, data.items).some((a) => ids.has(a.id)),
  );
}
export function moveValidation(data: Pick<InventoryData, 'items'>, selected: ItemRecord[], parent: string) {
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
