import { randomUUID } from 'node:crypto';
import {
  QuantityDecimal as Decimal,
  normalizeQuantity,
} from '../../../packages/contracts/src/units.js';
import type { StockStatus } from '../../../packages/contracts/src/semantics.js';
import { requireFact, terminal } from '../../../packages/domain/src/index.js';
import { query, type Client } from './db.js';

// Aliases are fixed by the callers, never supplied by a request.
export function splitInfoSql(alias = 'o') {
  return `(SELECT to_jsonb(s) FROM (
    SELECT split_id,source_item_id,jsonb_agg(child_item_id ORDER BY child_item_id) AS child_item_ids,
      count(*)::int AS count,min(created_at)::text AS created_at
    FROM item_splits WHERE household_id=${alias}.household_id AND source_item_id IN
      (SELECT source_item_id FROM item_splits WHERE household_id=${alias}.household_id
       AND (source_item_id=${alias}.id OR child_item_id=${alias}.id))
    GROUP BY split_id,source_item_id ORDER BY source_item_id=${alias}.id DESC LIMIT 1) s)`;
}
export async function splitInfo(c: Client, household: string, item: string) {
  return (
    (
      await query(
        c,
        `SELECT ${splitInfoSql()} AS split FROM items o WHERE household_id=$1 AND id=$2`,
        [household, item],
      )
    ).rows[0]?.split ?? null
  );
}
export async function assertVoidable(c: Client, household: string, obj: any) {
  requireFact(obj.row.record_state !== 'VOID', 'STATE_CONFLICT', 'Record is already void.');
  if (obj.kind === 'ITEM') {
    const blocked = await query(
      c,
      `WITH RECURSIVE descendants AS (
      SELECT child_item_id FROM item_splits WHERE household_id=$1 AND source_item_id=$2
      UNION SELECT s.child_item_id FROM item_splits s JOIN descendants d ON s.source_item_id=d.child_item_id WHERE s.household_id=$1)
      SELECT 1 FROM items WHERE household_id=$1 AND (parent_id=$2 OR (id IN (SELECT child_item_id FROM descendants) AND record_state='VALID')) LIMIT 1`,
      [household, obj.row.id],
    );
    requireFact(
      !blocked.rows.length,
      'STATE_CONFLICT',
      'Item has children or valid split descendants.',
    );
  } else {
    requireFact(obj.row.kind === 'SKU', 'STATE_CONFLICT', 'Only an unused SKU can be voided.');
    const blocked = await query(
      c,
      `SELECT 1 WHERE
      EXISTS(SELECT 1 FROM items WHERE household_id=$1 AND catalog_node_id=$2) OR
      EXISTS(SELECT 1 FROM catalog_nodes WHERE household_id=$1 AND parent_id=$2) OR
      EXISTS(SELECT 1 FROM barcode_index WHERE household_id=$1 AND catalog_node_id=$2) OR
      EXISTS(SELECT 1 FROM catalog_identity_keys WHERE household_id=$1 AND catalog_node_id=$2) OR
      EXISTS(SELECT 1 FROM attribute_references r WHERE r.household_id=$1 AND r.target_kind='CATALOG_NODE' AND r.target_id=$2 AND (
        (r.source_kind='ITEM' AND EXISTS(SELECT 1 FROM items i WHERE i.household_id=$1 AND i.id=r.source_id AND i.record_state='VALID')) OR
        (r.source_kind='CATALOG_NODE' AND EXISTS(SELECT 1 FROM catalog_nodes n WHERE n.household_id=$1 AND n.id=r.source_id AND n.record_state='VALID')))) OR
      EXISTS(SELECT 1 FROM household_settings WHERE household_id=$1 AND container_catalog_id=$2) OR
      EXISTS(SELECT 1 FROM installations WHERE household_id=$1 AND container_catalog_id=$2) OR
      EXISTS(SELECT 1 FROM attachments WHERE household_id=$1 AND target_kind='CATALOG_NODE' AND target_id=$2 AND detached_at IS NULL) OR
      EXISTS(SELECT 1 FROM notes WHERE household_id=$1 AND target_kind='CATALOG_NODE' AND target_id=$2 AND archived_at IS NULL) OR
      EXISTS(SELECT 1 FROM (SELECT rules FROM catalog_policy_versions WHERE household_id=$1 ORDER BY revision DESC LIMIT 1) p,
        jsonb_array_elements(p.rules) r WHERE r->>'branch_id'=$2 OR r->'legacy_exceptions' ? $2 OR
        EXISTS(SELECT 1 FROM jsonb_array_elements(r->'aliases') a WHERE a->>'catalog_node_id'=$2))`,
      [household, obj.row.id],
    );
    requireFact(
      !blocked.rows.length && !obj.sets.product?.barcodes?.length,
      'STATE_CONFLICT',
      'SKU still has business or system references.',
    );
    // All owned derived indexes are removed with the record transition.
    await query(
      c,
      "DELETE FROM attribute_references WHERE household_id=$1 AND source_kind='CATALOG_NODE' AND source_id=$2",
      [household, obj.row.id],
    );
  }
}
export async function assertNoSplitRestore(c: Client, household: string, id: string) {
  requireFact(
    !(
      await query(
        c,
        'SELECT 1 FROM item_splits WHERE household_id=$1 AND source_item_id=$2 LIMIT 1',
        [household, id],
      )
    ).rows.length,
    'STATE_CONFLICT',
    'A split source cannot be restored while split records exist.',
  );
}
export async function prepareSplit(c: Client, household: string, obj: any, input: any) {
  requireFact(
    obj.row.record_state !== 'VOID' && !terminal.has(obj.sets.lifecycle?.state),
    'STATE_CONFLICT',
    'Split source must be a valid non-terminal item.',
  );
  requireFact(
    !(
      await query(c, 'SELECT 1 FROM items WHERE household_id=$1 AND parent_id=$2 LIMIT 1', [
        household,
        obj.row.id,
      ])
    ).rows.length,
    'STATE_CONFLICT',
    'Split source must have no children.',
  );
  await assertNoSplitRestore(c, household, obj.row.id);
  const remaining = obj.sets.contents?.remaining;
  requireFact(
    remaining && new Decimal(remaining.value).gt(0) && remaining.unit !== 'percent',
    'STATE_CONFLICT',
    'Split requires known positive additive contents.',
  );
  const sets = Object.fromEntries(
    (input.child_attributes ?? []).map((a: any) => [a.template_id, a.values]),
  ) as Record<string, any>;
  requireFact(
    !sets.asset?.serial_no &&
      !sets.asset?.imei &&
      !sets.asset?.mac &&
      !sets.asset?.price &&
      !sets.lifecycle?.opening,
    'STATE_CONFLICT',
    'Split cannot copy identity, price, or opening facts.',
  );
  const child = sets.contents?.remaining;
  requireFact(
    child && new Decimal(child.value).gt(0) && !terminal.has(sets.lifecycle?.state),
    'SPLIT_NOT_CONSERVED',
    'Each child needs explicit positive contents.',
  );
  const sourceQ = normalizeQuantity(remaining, ['mass', 'volume', 'length', 'count']);
  const childQ = normalizeQuantity(child, ['mass', 'volume', 'length', 'count']);
  requireFact(
    sourceQ.unit === childQ.unit && new Decimal(childQ.value).times(input.count).eq(sourceQ.value),
    'SPLIT_NOT_CONSERVED',
    'Child quantities must conserve the source in the same dimension.',
  );
  return {
    split_id: 'split_' + randomUUID(),
    quantity: childQ.value,
    unit: childQ.unit,
    basis: sourceQ.unit === 'count' ? 'COUNT' : 'CONTENT',
  };
}
export function stockStatus(sku: any, items: any[]): StockStatus {
  const stock = sku.attributes.find((a: any) => a.template_id === 'stock').values;
  const current = items.filter(
    (i) =>
      i.record_state !== 'VOID' &&
      !terminal.has(i.attributes.find((a: any) => a.template_id === 'lifecycle')?.values.state),
  );
  let total = new Decimal(0),
    unknown = 0;
  if (stock.basis === 'COUNT') total = new Decimal(current.length);
  else
    for (const item of current) {
      const q = item.attributes.find((a: any) => a.template_id === 'contents')?.values.remaining;
      if (!q || q.unit !== stock.content_unit || q.unit === 'percent') unknown++;
      else total = total.plus(q.value);
    }
  // Unknown quantities are nonnegative: a known subtotal >= threshold proves not low.
  const threshold = stock.reorder_threshold ?? null,
    target = stock.target ?? null;
  const low = threshold === null ? null : total.gte(threshold) ? false : unknown ? null : true;
  return {
    catalog_node_id: sku.id,
    name: sku.name,
    profile: sku.profile ?? null,
    basis: stock.basis,
    unit: stock.basis === 'COUNT' ? 'count' : stock.content_unit,
    threshold,
    target,
    current_count: stock.basis === 'COUNT' ? current.length : null,
    current_content: stock.basis === 'CONTENT' ? total.toFixed() : null,
    unknown_count: unknown,
    low,
    gap:
      target === null || unknown
        ? null
        : Decimal.max(0, new Decimal(target).minus(total)).toFixed(),
  };
}
