import { query, transaction } from './db.js';
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
      await query(c, 'SELECT id,name FROM households WHERE id=$1', [ctx.household_id])
    ).rows[0];
    const installation = (
      await query(c, 'SELECT container_catalog_id FROM installations WHERE household_id=$1', [
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
          'SELECT id,parent_id,kind,name,revision,attributes FROM catalog_nodes WHERE household_id=$1 ORDER BY created_at,id',
          [ctx.household_id],
        )
      ).rows,
      items: (
        await query(
          c,
          'SELECT id,parent_id,catalog_node_id,display_name,revision,attributes,created_at FROM items WHERE household_id=$1 ORDER BY created_at,id',
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
    return { ...data, groups: productGroups(data, parsed.data) };
  });
}
