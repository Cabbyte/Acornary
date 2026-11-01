import { referenceSchema } from '../../../packages/contracts/src/semantics.js';
import { requireFact } from '../../../packages/domain/src/index.js';
import { query, type Client } from './db.js';
const referencePaths = {
  custody: ['owner', 'holder'],
  wardrobe: ['owner'],
  disposition: ['recipient'],
};
// Caller holds the household write lock and owns the transaction.
export async function maintainReferences(
  c: Client,
  household: string,
  obj: { kind: string; row: any; sets: Record<string, any>; versions?: Record<string, number> },
) {
  const refs: { template: string; path: string; kind: string; id: string }[] = [];
  for (const [template, paths] of Object.entries(referencePaths))
    for (const path of paths) {
      if ((obj.versions?.[template] ?? 1) !== 1) continue;
      const value = obj.sets[template]?.[path];
      if (!value) continue;
      const parsed = referenceSchema.safeParse(value);
      requireFact(parsed.success, 'REFERENCE_INVALID', 'Invalid typed reference.');
      const ref = parsed.data!;
      if (ref.kind === 'EXTERNAL') continue;
      const table = { ACTOR: 'actors', ITEM: 'items', CATALOG_NODE: 'catalog_nodes' }[ref.kind];
      const found = await query(c, `SELECT 1 FROM ${table} WHERE household_id=$1 AND id=$2`, [
        household,
        ref.id,
      ]);
      requireFact(
        found.rows.length,
        'REFERENCE_INVALID',
        'Reference target must exist in this household.',
      );
      refs.push({ template, path, kind: ref.kind, id: ref.id });
    }
  await query(
    c,
    'DELETE FROM attribute_references WHERE household_id=$1 AND source_kind=$2 AND source_id=$3',
    [household, obj.kind, obj.row.id],
  );
  for (const ref of refs)
    await query(
      c,
      `INSERT INTO attribute_references(household_id,source_kind,source_id,template_id,path,target_kind,target_id) VALUES($1,$2,$3,$4,$5,$6,$7)`,
      [household, obj.kind, obj.row.id, ref.template, ref.path, ref.kind, ref.id],
    );
}
export async function reverseReferences(
  c: Client,
  household: string,
  target: { kind: string; id: string },
) {
  return (
    await query(
      c,
      `SELECT source_kind,source_id,template_id,path FROM attribute_references WHERE household_id=$1 AND target_kind=$2 AND target_id=$3 AND (
      (source_kind='ITEM' AND EXISTS(SELECT 1 FROM items i WHERE i.household_id=$1 AND i.id=source_id AND i.record_state='VALID')) OR
      (source_kind='CATALOG_NODE' AND EXISTS(SELECT 1 FROM catalog_nodes n WHERE n.household_id=$1 AND n.id=source_id AND n.record_state='VALID'))) ORDER BY source_kind,source_id,template_id,path`,
      [household, target.kind, target.id],
    )
  ).rows;
}
