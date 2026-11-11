// Private review adapter: derive display facts from the current isolated world,
// including persisted trial rows whose original ItemView text is now stale.
import type { DailyItemFacts } from '../../src/features/daily/pages/models';
import type { FactView, ItemView } from '../../src/features/inventory/model/types';
import { amount } from '../../src/lib/presentation';

export function managementItemFromFacts({ item, quantity }: DailyItemFacts): ItemView {
  const previous = item.facts.find((fact) => fact.kind === 'remaining');
  if (!previous && quantity.value === null && !quantity.unit && item.profile !== 'CONSUMABLE')
    return item;

  const unknown = quantity.value === null || quantity.value === '';
  const valid = !unknown && /^\d+(?:\.\d+)?$/.test(quantity.value!);
  const value = unknown
    ? '数量未记录'
    : !valid
      ? '数量格式有误'
      : `${quantity.accuracy === 'estimated' ? '约 ' : ''}${amount(quantity.value!, quantity.unit || '单位未记录')}${quantity.accuracy === 'unknown' ? '（精度未记录）' : ''}`;
  const remaining: FactView = {
    ...previous,
    kind: 'remaining',
    label: previous?.label ?? '剩余',
    priority: previous?.priority ?? 1,
    value,
  };
  return {
    ...item,
    facts: [...item.facts.filter((fact) => fact.kind !== 'remaining'), remaining].sort(
      (left, right) => left.priority - right.priority,
    ),
  };
}
