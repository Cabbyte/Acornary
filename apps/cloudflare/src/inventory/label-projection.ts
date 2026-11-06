import { createHash } from 'node:crypto';
import { query, transaction, type Client } from './db.js';
import { recordSyncChange } from './sync.js';
import {
  terminalLabelTimes,
  labelHistoryPaths,
  type LabelHistoryEvent,
} from './terminal-label-history.js';
import type { InventoryData } from '../../../../packages/contracts/src/web.js';

const values = (row: any, template: string) =>
  row?.attributes.find((a: any) => a.template_id === template)?.values;
export function labelHash(item: any, sku: any): string {
  const expiry = values(item, 'lifecycle')?.expiry;
  const date = expiry?.date || null;
  const title = !date
    ? null
    : ((
        { ESTIMATED: '计划吃完', USE_BY: '保质期', BEST_BEFORE: '最佳食用期' } as Record<
          string,
          string
        >
      )[expiry?.date_kind] ?? '到期日期');
  return createHash('sha256')
    .update(
      JSON.stringify([
        item.display_name || sku?.name || '未命名物品',
        values(sku, 'product')?.specification || '',
        date,
        title,
      ]),
    )
    .digest('hex');
}

/** Called after the source event and sync reference, under the existing household lock.
 * Catalog fan-out publishes item projection changes without increasing item core revisions. */
export function projectLabels(
  c: Client,
  household: string,
  kind: 'ITEM' | 'CATALOG_NODE',
  id: string,
  eventId: string,
  operationId: string,
) {
  const event = query<LabelHistoryEvent>(
    c,
    'SELECT * FROM events WHERE household_id=?1 AND id=?2',
    [household, eventId],
  ).rows[0];
  const relevant = event.changes.some((d) => labelHistoryPaths.includes(d.path));
  if (kind === 'CATALOG_NODE' && !relevant) return;
  const specificationChanged = event.changes.some(
    (d) => d.path === 'attributes.product.specification',
  );
  const rows = query(
    c,
    `SELECT i.* FROM items i JOIN catalog_nodes s
    ON s.household_id=i.household_id AND s.id=i.catalog_node_id
    WHERE i.household_id=?1 AND ${kind === 'ITEM' ? 'i.id=?2' : 'i.catalog_node_id=?2'}
    ${kind === 'CATALOG_NODE' && !specificationChanged ? "AND coalesce(i.display_name,'')=''" : ''}`,
    [household, id],
  ).rows;
  let history: Map<string, string> | undefined;
  for (const item of rows) {
    item.sku = query(c, 'SELECT * FROM catalog_nodes WHERE household_id=?1 AND id=?2', [
      household,
      item.catalog_node_id,
    ]).rows[0];
    const hash = labelHash(item, item.sku);
    const changed = hash !== item.label_hash;
    // An old row not yet backfilled needs its historical timestamp before a non-label edit.
    // Reverse the current event too: the oracle handles same-value reassignments and hidden names.
    let historical: string | undefined;
    if (!item.label_hash) {
      if (kind === 'ITEM' && event.before_revision === 0)
        historical = new Date(item.created_at).toISOString();
      else {
        history ??= historicalLabels(c, household).times;
        historical = history.get(item.id);
      }
    }
    if (kind === 'CATALOG_NODE' && changed) {
      // A legacy row may still lack its hash. Compare the actual source tuple before this
      // event as well, so filling that missing hash does not invent a projection change.
      const previousSku = {
        name: item.sku.name,
        attributes: [
          {
            template_id: 'product',
            values: { specification: values(item.sku, 'product')?.specification },
          },
        ],
      };
      for (const delta of event.changes) {
        if (delta.path === 'name') previousSku.name = delta.before;
        if (delta.path === 'attributes.product.specification')
          previousSku.attributes[0].values.specification = delta.before;
      }
      if (item.label_hash || labelHash(item, previousSku) !== hash)
        recordSyncChange(c, household, 'ITEM', item.id, item.revision, operationId);
    }
    query(
      c,
      `UPDATE items SET label_hash=?3,
      label_updated_at=CASE WHEN ?4 THEN max(created_at,?5) ELSE label_updated_at END,
      projected_through_change_id=(SELECT last_committed_change_id FROM household_sync_state WHERE household_id=?1)
      WHERE household_id=?1 AND id=?2`,
      [household, item.id, hash, changed, historical ?? event.recorded_at],
    );
  }
}

function historicalLabels(c: Client, household: string) {
  const catalog = query(c, 'SELECT * FROM catalog_nodes WHERE household_id=?1', [household]).rows;
  const items = query(c, 'SELECT * FROM items WHERE household_id=?1 ORDER BY id', [household]).rows;
  const events = query<LabelHistoryEvent>(
    c,
    `SELECT id,target_kind,target_id,before_revision,recorded_at,changes
    FROM events WHERE household_id=?1 AND EXISTS(SELECT 1 FROM json_each(changes) d
    WHERE d.value->>'path' IN (SELECT value FROM json_each(?2))) ORDER BY recorded_at DESC,id DESC`,
    [household, labelHistoryPaths],
  ).rows;
  const data = {
    catalog,
    items,
    notes: [],
    household: { id: household, name: '' },
    container_catalog_id: '',
    cached_at: '',
  } as InventoryData;
  return { data, times: terminalLabelTimes(data, events) };
}
export type LabelBackfill = {
  household: string;
  watermark: string;
  rows: { id: string; hash: string; time: string }[];
};
/** Capture before taking the write lock, so ordinary writes remain available during history replay. */
export function captureLabelBackfill(db: Client, household: string): LabelBackfill {
  return transaction(db, (c) => {
    const watermark =
      query(
        c,
        'SELECT last_committed_change_id AS id FROM household_sync_state WHERE household_id=?1',
        [household],
      ).rows[0]?.id ?? '0';
    const { data, times } = historicalLabels(c, household);
    const catalog = new Map(data.catalog.map((s) => [s.id, s]));
    return {
      household,
      watermark,
      rows: data.items.map((i) => ({
        id: i.id,
        hash: labelHash(i, catalog.get(i.catalog_node_id)),
        time: times.get(i.id)!,
      })),
    };
  });
}
/** Guard each batch against H+ writes; checkpoint and rows commit together. Safe to resume/replay. */
export function applyLabelBackfill(db: Client, snapshot: LabelBackfill, batchSize = 200) {
  if (!Number.isInteger(batchSize) || batchSize < 1)
    throw new Error('Invalid label backfill batch size');
  for (let offset = 0; offset < snapshot.rows.length; offset += batchSize) {
    const batch = snapshot.rows.slice(offset, offset + batchSize);
    transaction(db, (c) => {
      for (const row of batch)
        query(
          c,
          `UPDATE items SET label_hash=?3,label_updated_at=max(created_at,?4),
          projected_through_change_id=?5 WHERE household_id=?1 AND id=?2
          AND CAST(projected_through_change_id AS INTEGER) <= CAST(?5 AS INTEGER) AND label_hash IS NULL`,
          [snapshot.household, row.id, row.hash, row.time, snapshot.watermark],
        );
      query(
        c,
        `INSERT INTO label_projection_checkpoint(household_id,through_item_id,as_of_change_id,completed)
        VALUES(?1,?2,?3,?4) ON CONFLICT(household_id) DO UPDATE SET through_item_id=excluded.through_item_id,
        as_of_change_id=excluded.as_of_change_id,completed=excluded.completed
        WHERE CAST(label_projection_checkpoint.as_of_change_id AS INTEGER) <= CAST(excluded.as_of_change_id AS INTEGER)`,
        [
          snapshot.household,
          batch.at(-1)!.id,
          snapshot.watermark,
          offset + batchSize >= snapshot.rows.length,
        ],
      );
    });
  }
}
/** Only the first read of a legacy household replays history. Normal terminal reads use the index. */
export function ensureLabelProjection(db: Client, household: string) {
  const missing = transaction(db, (c) =>
    query(c, 'SELECT 1 FROM items WHERE household_id=?1 AND label_hash IS NULL LIMIT 1', [
      household,
    ]),
  );
  if (missing.rows.length) applyLabelBackfill(db, captureLabelBackfill(db, household));
}
