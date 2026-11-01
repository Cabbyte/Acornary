import type { ProductGroupV2 } from '../../../../../../packages/contracts/src/read-v2.js';
import type { ProductGroup } from '../../../../../../packages/contracts/src/web.js';
import type { GroupView } from '../model/types.js';
import { nextDateFact } from './dates.js';

const isV2Group = (group: ProductGroupV2 | ProductGroup): group is ProductGroupV2 =>
  'next_date' in group || 'profile' in group || 'low_stock' in group || 'overdue_count' in group;

export function adaptGroup(group: ProductGroupV2 | ProductGroup): GroupView {
  const v2 = isV2Group(group) ? group : undefined;
  return {
    id: group.id,
    name: group.name,
    profile: v2?.profile ?? null,
    count: group.count,
    currentCount: group.current_count,
    opened: group.opened,
    sealed: group.sealed,
    unknownOpening: group.unknown_opening,
    unknownLifecycle: group.unknown_lifecycle,
    locations: group.locations,
    totals: group.totals.map((total) => ({
      unit: total.unit,
      value: total.value,
      estimated: total.estimated,
      unknownAccuracy: total.unknown_accuracy,
    })),
    unknownQuantity: group.unknown_quantity,
    nextDate: nextDateFact(v2?.next_date),
    overdueCount: v2?.overdue_count ?? null,
    lowStock: v2?.low_stock ?? null,
    hasItemIds: !v2 && 'item_ids' in group,
  };
}
