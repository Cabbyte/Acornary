import type { CatalogView, ItemView } from '../../inventory/model/types.js';
import { categoryIcon, categoryTone, type CategoryTone } from '../../../ui/icons/category.js';
import type { IconName } from '../../../ui/icons/names.js';

export type AttentionTone = 'danger' | 'warning' | 'neutral';

export type Attention = {
  kind: 'expired' | 'today' | 'soon' | 'void' | 'other';
  label: string;
  tone: AttentionTone;
  days?: number;
};

export type EnrichedItem = {
  item: ItemView;
  product: string;
  category: string;
  tone: CategoryTone;
  icon: IconName;
  remaining?: string;
  expiry?: string;
  attention: Attention | null;
};

const DAY = 86_400_000;

export function todayFor(timezone: string): string {
  try {
    const parts = new Intl.DateTimeFormat('en-CA', {
      timeZone: timezone,
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
    }).formatToParts(new Date());
    const part = (type: string) => parts.find((p) => p.type === type)?.value ?? '';
    return `${part('year')}-${part('month')}-${part('day')}`;
  } catch {
    return new Date().toISOString().slice(0, 10);
  }
}

function dateValue(value: string | undefined): number | null {
  if (!value || !/^\d{4}-\d{2}-\d{2}$/.test(value)) return null;
  const [y, m, d] = value.split('-').map(Number);
  return Date.UTC(y, m - 1, d);
}

export function attentionFor(item: ItemView, today: string): Attention | null {
  if (item.recordState === 'VOID') return { kind: 'void', label: '已作废', tone: 'danger' };
  const expiry = item.facts.find((fact) => fact.kind === 'expiry')?.value;
  const due = dateValue(expiry);
  const now = dateValue(today);
  if (due !== null && now !== null) {
    const days = Math.round((due - now) / DAY);
    if (days < 0) {
      return {
        kind: 'expired',
        label: `已过期 ${Math.abs(days)} 天`,
        tone: 'danger',
        days,
      };
    }
    if (days === 0) return { kind: 'today', label: '今天到期', tone: 'warning', days };
    if (days <= 7) return { kind: 'soon', label: `临期 ${days} 天`, tone: 'warning', days };
  }
  if (item.status.label !== '在库' && item.status.label !== '可用') {
    const tone: AttentionTone =
      item.status.tone === 'danger' || item.status.tone === 'warning'
        ? item.status.tone
        : 'neutral';
    return { kind: 'other', label: item.status.label, tone };
  }
  return null;
}

export function categoryPath(item: ItemView, catalog: ReadonlyMap<string, CatalogView>): string[] {
  const names: string[] = [];
  const seen = new Set<string>();
  let cursor = catalog.get(item.skuId)?.parentId ?? null;
  while (cursor && !seen.has(cursor)) {
    seen.add(cursor);
    const node = catalog.get(cursor);
    if (!node) break;
    names.unshift(node.name);
    cursor = node.parentId;
  }
  return names.length ? names : ['其他'];
}

export function enrichItem(
  item: ItemView,
  catalog: ReadonlyMap<string, CatalogView>,
  today: string,
): EnrichedItem {
  const path = categoryPath(item, catalog);
  const category = path[0] ?? '其他';
  const product = catalog.get(item.skuId)?.name ?? item.name;
  return {
    item,
    product,
    category,
    tone: categoryTone(category),
    icon: categoryIcon(item.name, product, category),
    remaining: item.facts.find((fact) => fact.kind === 'remaining')?.value,
    expiry: item.facts.find((fact) => fact.kind === 'expiry')?.value,
    attention: attentionFor(item, today),
  };
}

export function physicalItems(items: readonly ItemView[], containerIds: ReadonlySet<string>) {
  return items.filter((item) => !containerIds.has(item.id));
}

export function isAttention(item: EnrichedItem): boolean {
  return item.attention !== null;
}

export function sortEnriched(
  entries: readonly EnrichedItem[],
  sort: 'attention' | 'name',
): EnrichedItem[] {
  return [...entries].sort((a, b) => {
    if (sort === 'attention') {
      const rank = (entry: EnrichedItem) =>
        entry.attention?.tone === 'danger' ? 0 : entry.attention?.tone === 'warning' ? 1 : 2;
      const byTone = rank(a) - rank(b);
      if (byTone) return byTone;
      if (a.attention?.days !== undefined && b.attention?.days !== undefined) {
        const byDays = a.attention.days - b.attention.days;
        if (byDays) return byDays;
      }
    }
    return a.item.name.localeCompare(b.item.name, 'zh-CN');
  });
}

export function groupByCategory(entries: readonly EnrichedItem[]) {
  const groups = new Map<string, EnrichedItem[]>();
  for (const entry of entries)
    groups.set(entry.category, [...(groups.get(entry.category) ?? []), entry]);
  return [...groups.entries()].sort((a, b) => b[1].length - a[1].length);
}
