import { attr, type InventoryData } from '../../../packages/contracts/src/web.js';

export const labelHistoryPaths = [
  'display_name', 'catalog_node_id', 'name',
  'attributes.product.specification',
  'attributes.lifecycle.expiry.date', 'attributes.lifecycle.expiry.date_kind',
];
export interface LabelHistoryEvent {
  id: string; target_kind: string; target_id: string; before_revision: number;
  recorded_at: string | Date;
  changes: { path: string; before?: unknown; after?: unknown }[];
}
type Item = { sku: string; name?: string | null; date?: string; kind?: string };
type Catalog = { name?: string; specification?: string };
const iso = (date: string | Date) => new Date(date).toISOString();
function content(item: Item | undefined, catalog: Map<string, Catalog>) {
  if (!item) return null;
  const sku = catalog.get(item.sku);
  const dateTitle = !item.date ? null : item.kind === 'ESTIMATED' ? '计划吃完'
    : item.kind === 'USE_BY' ? '保质期' : item.kind === 'BEST_BEFORE' ? '最佳食用期' : '到期日期';
  return JSON.stringify([item.name || sku?.name || '未命名物品', sku?.specification || '', item.date || null, dateTitle]);
}
/** Reverse only label fields through recorded history. An effective-label comparison avoids
 * counting hidden SKU names, same-value catalog reassignment, and date kinds without dates.
 * No inventory mutations, N+1 queries, or client-supplied occurred_at sorting. */
export function terminalLabelTimes(data: InventoryData, events: LabelHistoryEvent[]): Map<string, string> {
  const items = new Map<string, Item>();
  const catalog = new Map<string, Catalog>();
  const bySku = new Map<string, Set<string>>();
  const result = new Map(data.items.map(i => [i.id, iso(i.created_at)]));
  const resolved = new Set<string>();
  for (const c of data.catalog) catalog.set(c.id, { name: c.name, specification: attr(c, 'product')?.specification });
  for (const i of data.items) {
    const life = attr(i, 'lifecycle');
    items.set(i.id, { sku: i.catalog_node_id, name: i.display_name, date: life?.expiry?.date, kind: life?.expiry?.date_kind });
    if (!bySku.has(i.catalog_node_id)) bySku.set(i.catalog_node_id, new Set());
    bySku.get(i.catalog_node_id)!.add(i.id);
  }
  const record = (id: string, before: string | null, after: string | null, time: string | Date) => {
    if (before !== after && !resolved.has(id)) {
      // Incomplete legacy history must never move creation backwards.
      result.set(id, iso(new Date(Math.max(Date.parse(result.get(id)!), new Date(time).getTime()))));
      resolved.add(id);
    }
  };
  // The SQL already orders these; sorting also makes this pure helper safe for other readers.
  const ordered = [...events].sort((a,b) => new Date(b.recorded_at).getTime() - new Date(a.recorded_at).getTime() || b.id.localeCompare(a.id));
  for (const event of ordered) {
    const relevant = event.changes.filter(c => labelHistoryPaths.includes(c.path));
    if (!relevant.length) continue;
    if (event.target_kind === 'ITEM') {
      const item = items.get(event.target_id);
      if (!item) continue;
      const after = content(item, catalog), oldSku = item.sku;
      for (const c of relevant) {
        if (c.path === 'display_name') item.name = c.before as string | null | undefined;
        if (c.path === 'catalog_node_id') item.sku = c.before as string;
        if (c.path === 'attributes.lifecycle.expiry.date') item.date = c.before as string | undefined;
        if (c.path === 'attributes.lifecycle.expiry.date_kind') item.kind = c.before as string | undefined;
      }
      bySku.get(oldSku)?.delete(event.target_id);
      if (event.before_revision === 0) items.delete(event.target_id);
      else {
        if (!bySku.has(item.sku)) bySku.set(item.sku, new Set());
        bySku.get(item.sku)!.add(event.target_id);
      }
      record(event.target_id, content(items.get(event.target_id), catalog), after, event.recorded_at);
    } else if (event.target_kind === 'CATALOG_NODE') {
      const ids = [...(bySku.get(event.target_id) ?? [])];
      const after = new Map(ids.map(id => [id, content(items.get(id), catalog)]));
      const sku = catalog.get(event.target_id) ?? {};
      for (const c of relevant) {
        if (c.path === 'name') sku.name = c.before as string | undefined;
        if (c.path === 'attributes.product.specification') sku.specification = c.before as string | undefined;
      }
      if (event.before_revision === 0) catalog.delete(event.target_id); else catalog.set(event.target_id, sku);
      for (const id of ids) record(id, content(items.get(id), catalog), after.get(id)!, event.recorded_at);
    }
  }
  return result;
}
