import { findTemplate } from '../../../packages/contracts/src/registry.js';
import { splitInfoSql } from './semantics.js';
import { Decimal } from 'decimal.js';
import type {
  CatalogRecord as CatalogRecordV2,
  ItemRecord as ItemRecordV2,
  ProductGroup as ProductGroupV2,
  SnapshotV2,
} from '../../../packages/contracts/src/sync.js';
import { currentChangeId } from './change-watermark.js';
import { decorateRecords } from './registry.js';
import { query, transaction, type Client } from './db.js';
import type { Context } from './service.js';
import { DomainError } from '../../../packages/domain/src/index.js';
import {
  inventoryFilterSchema,
  productGroups,
  type InventoryData,
} from '../../../packages/contracts/src/web.js';

// A coherent household snapshot, with a constant number of queries instead of per-item loads.
// No authentication tables or raw debug records are part of the product read model.
export async function webSnapshot(ctx: Context, rawFilter: unknown) {
  const parsed = inventoryFilterSchema.safeParse(rawFilter);
  if (!parsed.success)
    throw new DomainError(
      'ATTRIBUTE_VALIDATION_FAILED',
      'Invalid inventory filter.',
      parsed.error.issues,
    );
  return transaction(async (c) => {
    await query(c, 'SET TRANSACTION ISOLATION LEVEL REPEATABLE READ READ ONLY');
    const household = (
      await query(c, 'SELECT id,name,timezone FROM households WHERE id=$1', [ctx.household_id])
    ).rows[0];
    const installation = (
      await query(c, 'SELECT container_catalog_id FROM household_settings WHERE household_id=$1', [
        ctx.household_id,
      ])
    ).rows[0];
    const data: InventoryData = {
      household,
      container_catalog_id: installation?.container_catalog_id ?? '',
      cached_at: new Date().toISOString(),
      catalog: (
        await query(
          c,
          "SELECT id,parent_id,kind,name,revision,attributes,profile,capabilities,one_off,record_state,voided_at,created_at,updated_at FROM catalog_nodes WHERE household_id=$1 AND record_state='VALID' ORDER BY created_at,id",
          [ctx.household_id],
        )
      ).rows,
      items: (
        await query(
          c,
          "SELECT id,parent_id,catalog_node_id,display_name,revision,attributes,record_state,voided_at,created_at,updated_at FROM items WHERE household_id=$1 AND record_state='VALID' ORDER BY created_at,id",
          [ctx.household_id],
        )
      ).rows,
      notes: (
        await query(
          c,
          'SELECT id,item_id,title,body,updated_at FROM notes WHERE household_id=$1 ORDER BY updated_at DESC,id',
          [ctx.household_id],
        )
      ).rows,
    };
    await decorateRecords(c, ctx.household_id, data.catalog, data.items);
    return { ...data, groups: productGroups(data, parsed.data) };
  });
}

/** Server-only v2 aggregation: receives the complete SQL matching set, including containers.
 * Unlike the v1 UI helper it does not apply another, subtly different filter. */
export function inventoryGroupsV2(items: any[], catalog: any[]): ProductGroupV2[] {
  const skus = new Map(catalog.map((s) => [s.id, s]));
  const groups = new Map<string, ProductGroupV2>();
  const locations = new Map<string, Set<string>>();
  for (const item of items) {
    const sku = skus.get(item.catalog_node_id);
    if (!sku) continue;
    let group = groups.get(sku.id);
    if (!group) {
      group = {
        id: sku.id,
        name: sku.name,
        profile: sku.profile ?? null,
        count: 0,
        current_count: 0,
        opened: 0,
        sealed: 0,
        unknown_opening: 0,
        unknown_lifecycle: 0,
        locations: 0,
        totals: [],
        unknown_quantity: 0,
        next_date: null,
        overdue_count: 0,
        low_stock: null,
      };
      groups.set(sku.id, group);
      locations.set(sku.id, new Set());
    }
    group.count++;
    locations.get(sku.id)!.add(item.parent_id ?? '');
    group.locations = locations.get(sku.id)!.size;
    const sets = Object.fromEntries(item.attributes.map((a: any) => [a.template_id, a.values]));
    if (['CONSUMED', 'DISPOSED', 'LOST', 'ARCHIVED'].includes(sets.lifecycle?.state)) continue;
    group.current_count++;
    if (!sets.lifecycle?.state) group.unknown_lifecycle++;
    if (sets.lifecycle?.opening?.state === 'OPENED') group.opened++;
    else if (sets.lifecycle?.opening?.state === 'SEALED') group.sealed++;
    else group.unknown_opening++;
    const remaining = sets.contents?.remaining;
    if (!remaining || remaining.unit === 'percent') {
      group.unknown_quantity++;
      continue;
    }
    let total = group.totals.find((t) => t.unit === remaining.unit);
    if (!total) {
      total = { unit: remaining.unit, value: '0', estimated: false, unknown_accuracy: false };
      group.totals.push(total);
    }
    total.value = new Decimal(total.value).plus(remaining.value).toFixed();
    total.estimated ||= sets.contents.accuracy === 'ESTIMATED';
    total.unknown_accuracy ||= !sets.contents.accuracy;
  }
  return [...groups.values()].sort((a, b) => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0));
}
const iso = (value: Date | string) => new Date(value).toISOString();
function baseRecord(row: any) {
  return {
    id: row.id,
    parent_id: row.parent_id,
    revision: row.revision,
    record_state: row.record_state ?? 'VALID',
    voided_at: row.voided_at ?? null,
    effective_capabilities: row.effective_capabilities ?? [],
    attributes: row.attributes.map((a: any) => ({
      template_id: a.template_id,
      template_version: a.template_version,
      values: a.values,
      status: a.status ?? (findTemplate(a.template_id, a.template_version) ? 'KNOWN' : 'UNKNOWN'),
    })),
    created_at: iso(row.created_at),
    updated_at: iso(row.updated_at),
    redacted_paths: [],
    last_change_id: String(row.last_change_id ?? '0'),
  };
}
export function catalogRecordV2(row: any): CatalogRecordV2 {
  return {
    ...baseRecord(row),
    kind: row.kind,
    name: row.name,
    profile: row.profile ?? null,
    capabilities: row.capabilities ?? null,
    one_off: row.one_off ?? false,
  };
}
export function itemRecordV2(row: any): ItemRecordV2 {
  return {
    ...baseRecord(row),
    catalog_node_id: row.catalog_node_id,
    display_name: row.display_name,
    note_count: Number(row.note_count ?? 0),
    attachment_count: 0,
    next_date: null,
    split: row.split ?? null,
  };
}
/** Whitelisted DTOs deliberately exclude household internals, note bodies and label hashes. */
type RecordSelection = { ids?: string[]; after?: string; limit?: number; skuIds?: string[] };
export async function readCatalogV2(c: Client, household: string, selection: RecordSelection = {}) {
  const rows = (
    await query(
      c,
      `SELECT o.*,v.last_change_id::text FROM catalog_nodes o
    LEFT JOIN sync_object_versions v ON v.household_id=o.household_id AND v.object_kind='CATALOG_NODE' AND v.object_id=o.id
    WHERE o.household_id=$1 AND o.record_state='VALID' AND coalesce(v.change_kind,'UPSERT') <> 'TOMBSTONE'
    AND ($2::text[] IS NULL OR o.id=ANY($2::text[])) AND o.id > $3 ORDER BY o.id LIMIT $4`,
      [household, selection.ids ?? null, selection.after ?? '', selection.limit ?? null],
    )
  ).rows;
  await decorateRecords(c, household, rows, []);
  return rows.map(catalogRecordV2);
}
export async function readItemsV2(c: Client, household: string, selection: RecordSelection = {}) {
  const rows = (
    await query(
      c,
      `SELECT o.*,v.last_change_id::text,${splitInfoSql()} AS split,
    (SELECT count(*) FROM notes n WHERE n.household_id=o.household_id AND n.item_id=o.id) AS note_count
    FROM items o LEFT JOIN sync_object_versions v ON v.household_id=o.household_id AND v.object_kind='ITEM' AND v.object_id=o.id
    WHERE o.household_id=$1 AND o.record_state='VALID' AND coalesce(v.change_kind,'UPSERT') <> 'TOMBSTONE'
    AND ($2::text[] IS NULL OR o.id=ANY($2::text[])) AND o.id > $3
    AND ($5::text[] IS NULL OR o.catalog_node_id=ANY($5::text[])) ORDER BY o.id LIMIT $4`,
      [
        household,
        selection.ids ?? null,
        selection.after ?? '',
        selection.limit ?? null,
        selection.skuIds ?? null,
      ],
    )
  ).rows;
  const skuIds = [...new Set(rows.map((row) => row.catalog_node_id))];
  const catalog = skuIds.length
    ? (
        await query(c, `SELECT * FROM catalog_nodes WHERE household_id=$1 AND id=ANY($2::text[])`, [
          household,
          skuIds,
        ])
      ).rows
    : [];
  await decorateRecords(c, household, catalog, rows);
  return rows.map(itemRecordV2);
}
export async function readInventoryV2(c: Client, household: string) {
  const catalog = await readCatalogV2(c, household);
  const items = await readItemsV2(c, household);
  return { catalog, items, groups: inventoryGroupsV2(items, catalog) };
}
export async function webSnapshotV2(ctx: Context): Promise<SnapshotV2> {
  return transaction(async (c) => {
    await query(c, 'SET TRANSACTION ISOLATION LEVEL REPEATABLE READ READ ONLY');
    const household = (
      await query(c, 'SELECT id,name,timezone FROM households WHERE id=$1', [ctx.household_id])
    ).rows[0];
    const asOf = String(await currentChangeId(c, ctx.household_id));
    const time = new Date().toISOString();
    return {
      protocol: 2,
      household,
      as_of_change_id: asOf,
      server_time: time,
      ...(await readInventoryV2(c, ctx.household_id)),
      cached_at: time,
    };
  });
}
