import { Decimal } from 'decimal.js';
import {
  attr,
  isTerminal,
  type InventoryData,
  type ItemRecord,
} from '../../../../packages/contracts/src/web.js';
import { reminderDate } from '../../../../packages/domain/src/reminders.js';
import { fullPath } from './browse.js';
export type Attention = 'past' | 'soon' | 'low' | 'away';
export type GroupMode = 'product' | 'place' | 'date' | 'none';
export const attentionLabels: Record<Attention, string> = {
  past: '日期已过',
  soon: '近期日期',
  low: '余量不足 30%',
  away: '不在手边',
};
export function householdToday(timezone?: string, now = new Date()): string | undefined {
  if (!timezone) return;
  try {
    const parts = new Intl.DateTimeFormat('en-CA', {
      timeZone: timezone,
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
    }).formatToParts(now);
    return ['year', 'month', 'day'].map((t) => parts.find((p) => p.type === t)!.value).join('-');
  } catch {
    return;
  }
}
export function remainingPercent(item: ItemRecord, data: InventoryData): number | undefined {
  const amount = attr(item, 'contents')?.remaining;
  const sku = data.catalog.find((c) => c.id === item.catalog_node_id);
  const net = sku && attr(sku, 'product')?.net_content;
  if (!amount) return;
  try {
    const value = new Decimal(amount.value);
    if (!value.isFinite() || value.lt(0)) return;
    if (amount.unit === 'percent') return value.toNumber();
    if (net && net.unit === amount.unit && new Decimal(net.value).gt(0))
      return value.div(net.value).mul(100).toNumber();
  } catch {
    return;
  }
}
export function stashDate(item: ItemRecord, data: InventoryData) {
  const life = attr(item, 'lifecycle');
  const derived = data.household.timezone
    ? reminderDate(life, data.household.timezone)
    : { date: life?.expiry?.date, basis: [] };
  const opened = derived.date && derived.date !== life?.expiry?.date;
  const title = opened
    ? '开封后期限'
    : life?.expiry?.date_kind === 'USE_BY'
      ? '使用期限'
      : life?.expiry?.date_kind === 'BEST_BEFORE'
        ? '最佳食用期'
        : life?.expiry?.date_kind === 'ESTIMATED'
          ? '计划日期'
          : '记录日期';
  return { ...derived, title };
}
export function itemAttention(
  item: ItemRecord,
  data: InventoryData,
  today = householdToday(data.household.timezone),
): Attention[] {
  if (isTerminal(item)) return [];
  const result: Attention[] = [];
  const date = stashDate(item, data).date;
  if (today && date) {
    const end = new Date(`${today}T00:00:00Z`);
    end.setUTCDate(end.getUTCDate() + 14);
    if (date < today) result.push('past');
    else if (date <= end.toISOString().slice(0, 10)) result.push('soon');
  }
  const percent = remainingPercent(item, data);
  if (percent !== undefined && percent < 30) result.push('low');
  if (
    ['LOANED', 'CLEANING', 'MAINTENANCE', 'IN_TRANSIT'].includes(
      attr(item, 'lifecycle')?.availability ?? '',
    )
  )
    result.push('away');
  return result;
}
export type StashGroup = { id: string; title: string; items: ItemRecord[] };
export function stashGroups(
  items: ItemRecord[],
  data: InventoryData,
  mode: GroupMode,
): StashGroup[] {
  const groups = new Map<string, StashGroup>();
  for (const item of items) {
    const date = stashDate(item, data);
    const id =
      mode === 'product'
        ? item.catalog_node_id
        : mode === 'place'
          ? (item.parent_id ?? '')
          : (date.date ?? '');
    const title =
      mode === 'product'
        ? (data.catalog.find((c) => c.id === id)?.name ?? '商品资料不可用')
        : mode === 'place'
          ? fullPath(item.parent_id, data)
          : (date.date ?? '日期未记录');
    if (!groups.has(id)) groups.set(id, { id, title, items: [] });
    groups.get(id)!.items.push(item);
  }
  const result = [...groups.values()];
  return mode === 'date'
    ? result.sort((a, b) => (a.id || '9999').localeCompare(b.id || '9999'))
    : result;
}
