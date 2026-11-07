// Isolated read adapter data. Never imported by production pages or entrypoints.
import type {
  DailyItemFacts,
  DailyProductFacts,
  DailyItemProps,
} from '../../src/features/daily/pages/models';
import { group, items, searchItems, skuId, householdId } from '../fixtures';
export { householdId };
export const pageVersion = 'P01-RC1';
export const firstItemId = items[0].id;
export const firstProductId = skuId;
const newItemId = (suffix: string) => `item_00000000-0000-4000-8000-${suffix.padStart(12, '0')}`;
const cabinet = searchItems[3].location;
export const itemFacts: DailyItemFacts[] = [
  ...searchItems.map((item, index): DailyItemFacts => ({
    item:
      index === 0
        ? { ...item, location: { ...item.location, id: newItemId('30') } }
        : index === 7
          ? { ...item, location: cabinet }
          : item,
    quantity:
      index === 0
        ? { value: '310.0', unit: 'mL', accuracy: 'estimated' }
        : { value: null, unit: '', accuracy: 'unknown' },
    ...(index === 0
      ? {
          date: {
            kind: 'EXPIRY',
            dateKind: 'BEST_BEFORE',
            dueOn: '2026-11-10',
            basis: '包装标注',
            state: 'UPCOMING',
            source: 'LIFECYCLE',
            label: '最佳食用期',
          } as const,
        }
      : {}),
  })),
  {
    item: {
      ...items[0],
      id: newItemId('401'),
      location: cabinet,
      status: { label: '未开封', tone: 'neutral' },
      facts: [],
      revision: 1,
      noteCount: 0,
    },
    quantity: { value: '1000', unit: 'mL', accuracy: 'measured' },
    date: {
      kind: 'EXPIRY',
      dateKind: 'BEST_BEFORE',
      dueOn: '2026-12-01',
      basis: '包装标注',
      source: 'LIFECYCLE',
      state: 'UPCOMING',
      label: '最佳食用期',
    },
  },
  {
    item: {
      ...items[0],
      id: newItemId('402'),
      skuId: 'catalog_node_00000000-0000-4000-8000-000000000402',
      subtitle: '巧克力味 · 250 mL',
      location: cabinet,
      status: { label: '开封状态未记录', tone: 'neutral' },
      facts: [],
      revision: 1,
      noteCount: 0,
    },
    quantity: { value: null, unit: 'mL', accuracy: 'unknown' },
  },
];

// Decimal arithmetic belongs to the fixture adapter here; pages receive prepared summaries.
function sumDecimal(values: readonly string[]): string {
  const scale = Math.max(0, ...values.map((value) => (value.split('.')[1] || '').length));
  const sum = values
    .reduce((total, value) => {
      const [integer, fraction = ''] = value.split('.');
      return total + BigInt(integer + fraction.padEnd(scale, '0'));
    }, 0n)
    .toString()
    .padStart(scale + 1, '0');
  return scale ? `${sum.slice(0, -scale)}.${sum.slice(-scale)}` : sum;
}
export function productFactsFor(rows: readonly DailyItemFacts[]): DailyProductFacts[] {
  const ids = [...new Set(rows.map(({ item }) => item.skuId))];
  return ids.map((id) => {
    const members = rows.filter(({ item }) => item.skuId === id);
    const first = members[0];
    const measured = members.filter(({ quantity }) => quantity.value !== null);
    const totals = [...new Set(measured.map(({ quantity }) => quantity.unit))].map((unit) => {
      const quantities = measured
        .filter(({ quantity }) => quantity.unit === unit)
        .map(({ quantity }) => quantity);
      return {
        unit,
        value: sumDecimal(quantities.map((q) => q.value!)),
        estimated: quantities.some((q) => q.accuracy === 'estimated'),
        unknownAccuracy: quantities.some((q) => q.accuracy === 'unknown'),
      };
    });
    const dated = members
      .flatMap(({ date }) => (date?.dueOn ? [date] : []))
      .sort((a, b) => a.dueOn!.localeCompare(b.dueOn!));
    return {
      group: {
        ...group,
        id,
        name: `${first.item.name}${first.item.subtitle ? ` · ${first.item.subtitle}` : ''}`,
        profile: first.item.profile,
        count: members.length,
        currentCount: members.filter(({ item }) => item.recordState === 'VALID').length,
        locations: new Set(
          members.flatMap(({ item }) => (item.location.id ? [item.location.id] : [])),
        ).size,
        opened: members.filter(({ item }) => item.status.label === '已开封').length,
        sealed: members.filter(({ item }) => item.status.label === '未开封').length,
        unknownOpening: members.filter(({ item }) => item.status.label.includes('开封状态未记录'))
          .length,
        unknownLifecycle: members.filter(({ date }) => !date).length,
        totals,
        unknownQuantity: members.length - measured.length,
        nextDate: null,
        overdueCount: null,
        lowStock: null,
      },
      subtitle: first.item.subtitle || '',
      catalogPath:
        first.item.profile === 'CONSUMABLE'
          ? [
              '日用消耗品',
              first.item.name.includes('燕麦') || first.item.name === '咖啡豆'
                ? '食品饮料'
                : '清洁用品',
            ]
          : ['耐用品'],
      date: dated[0],
    };
  });
}
export const locationOptions = [
  ...new Map(
    itemFacts.flatMap(({ item }) =>
      item.location.id
        ? [
            [
              item.location.id,
              { id: item.location.id, label: item.location.path.join(' › ') },
            ] as const,
          ]
        : [],
    ),
  ).values(),
];
export const emptyProduct: DailyProductFacts = {
  group: {
    ...group,
    id: 'catalog_node_00000000-0000-4000-8000-000000000999',
    name: '燕麦饮 · 无糖 1 L',
    count: 0,
    currentCount: 0,
    opened: 0,
    sealed: 0,
    unknownOpening: 0,
    unknownLifecycle: 0,
    locations: 0,
    totals: [],
    unknownQuantity: 0,
  },
  subtitle: '无糖 · 1 L',
  catalogPath: ['日用消耗品', '食品饮料'],
};
export const notes: DailyItemProps['notes'] = [
  {
    id: 'note_00000000-0000-4000-8000-000000000001',
    itemId: firstItemId,
    title: '早餐搭配',
    excerpt: '做拿铁前摇匀，也可以加进燕麦粥。',
    body: '做拿铁前摇匀，也可以加进燕麦粥。\n开封后放在冰箱中层，方便早餐时拿取。',
    updatedAt: '2026-11-06T06:32:00Z',
    sensitivity: 'NORMAL',
  },
];
export const history: DailyItemProps['history'] = [
  {
    event: {
      id: 'event_00000000-0000-4000-8000-000000000007',
      target_kind: 'ITEM',
      target_id: firstItemId,
      operation_id: 'operation_00000000-0000-4000-8000-000000000007',
      event_type: 'ITEM_UPDATED',
      before_revision: 6,
      after_revision: 7,
      changes: [
        {
          path: 'contents.remaining',
          before_present: true,
          after_present: true,
          before: { value: '500', unit: 'mL' },
          after: { value: '310.0', unit: 'mL' },
          template_id: 'contents',
          template_version: 1,
        },
      ],
      reason: '早餐后记录剩余量',
      actor_id: 'actor_00000000-0000-4000-8000-000000000001',
      source: 'WEB',
      occurred_at: '2026-11-06T06:32:00Z',
      recorded_at: '2026-11-06T06:32:01Z',
    },
    operationLabel: '记录余量',
    actorLabel: '小林',
    objectLabel: '燕麦饮 · 原味',
    familyTimezone: 'Asia/Shanghai',
    changesPresentation: { 'contents.remaining': { label: '剩余量' } },
  },
];
