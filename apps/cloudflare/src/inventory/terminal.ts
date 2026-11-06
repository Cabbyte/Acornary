import { query, transaction } from './db.js';
import { type Context } from './service.js';
import { DomainError, reminderDate } from '../../../../packages/domain/src/index.js';
import {
  attr,
  ancestors,
  itemName,
  locationName,
  isTerminal,
  isContainer,
  type InventoryData,
} from '../../../../packages/contracts/src/web.js';
import {
  type TerminalItem,
  type TerminalSnapshot,
} from '../../../../packages/contracts/src/terminal.js';

import { ensureLabelProjection } from './label-projection.js';

/** Read the entire projection in one household transaction; no per-item SQL. */
export function terminalSnapshot(
  ctx: Context,
  itemId?: string,
): TerminalSnapshot & { notes?: unknown[] } {
  ensureLabelProjection(ctx.db, ctx.household_id);
  return transaction(ctx.db, (c) => {
    const household = query(c, 'SELECT id,name,timezone FROM households WHERE id=?1', [
      ctx.household_id,
    ]).rows[0];
    const data: InventoryData = {
      household,
      container_catalog_id: '',
      cached_at: new Date().toISOString(),
      notes: [],
      catalog: query(
        c,
        'SELECT id,parent_id,kind,name,revision,attributes FROM catalog_nodes WHERE household_id=?1',
        [ctx.household_id],
      ).rows,
      items: query(
        c,
        'SELECT id,parent_id,catalog_node_id,display_name,revision,attributes,created_at,label_updated_at FROM items WHERE household_id=?1 ORDER BY created_at,id',
        [ctx.household_id],
      ).rows,
    };
    const catalog = new Map(data.catalog.map((r) => [r.id, r]));
    const selected = data.items.filter((i) => (itemId ? i.id === itemId : !isTerminal(i)));
    if (itemId && !selected.length)
      throw new DomainError('NOT_FOUND', '物品不存在或不属于当前家庭。');
    const items: TerminalItem[] = selected.map((i) => {
      const life = attr(i, 'lifecycle');
      const contents = attr(i, 'contents');
      const sku = catalog.get(i.catalog_node_id);
      const product = sku && attr(sku, 'product');
      return {
        id: i.id,
        created_at: new Date(i.created_at).toISOString(),
        label_updated_at: new Date(
          (i as typeof i & { label_updated_at: string }).label_updated_at,
        ).toISOString(),
        name: itemName(i, data),
        brand: product?.brand ?? '',
        specification: product?.specification ?? '',
        revision: i.revision,
        is_container: isContainer(i),
        terminal: isTerminal(i),
        state: life?.state ?? null,
        opening_state: life?.opening?.state ?? null,
        opened_at: life?.opening?.opened_at ?? null,
        expiry_date: life?.expiry?.date ?? null,
        expiry_kind: life?.expiry?.date_kind ?? null,
        after_opening_days: life?.expiry?.after_opening_days ?? null,
        remaining: contents?.remaining ?? null,
        accuracy: contents?.accuracy ?? null,
        reminder: reminderDate(life, household.timezone),
        location_ids: ancestors(i.parent_id, data.items).map((x) => x.id),
        location: locationName(i, data),
      };
    });
    return {
      version: 1,
      household,
      synced_at: data.cached_at,
      items,
      ...(itemId
        ? {
            notes: query(
              c,
              `SELECT id,title,body,updated_at FROM notes WHERE household_id=?1 AND target_kind='ITEM' AND target_id=?2 AND sensitivity='NORMAL' AND archived_at IS NULL ORDER BY updated_at DESC,id`,
              [ctx.household_id, itemId],
            ).rows,
          }
        : {}),
    };
  });
}
