// Identity graph helpers for isolated location/catalog read projections.
import type { ManagedLocation } from '../../src/features/management/pages/models';
import type { DailyItemFacts } from '../../src/features/daily/pages/models';
type TreeRow = { id: string; parentId: string | null; name: string; path: string[] };
export function descendantsById(
  rows: readonly Pick<TreeRow, 'id' | 'parentId'>[],
  root: string,
): Set<string> {
  const result = new Set([root]);
  let grew = true;
  while (grew) {
    grew = false;
    for (const row of rows)
      if (row.parentId && result.has(row.parentId) && !result.has(row.id)) {
        result.add(row.id);
        grew = true;
      }
  }
  return result;
}
export function graphPath(
  rows: readonly TreeRow[],
  id: string,
  seen = new Set<string>(),
): string[] {
  if (seen.has(id))
    throw Object.assign(Error('对象树存在环，未修改。'), { code: 'CYCLE_DETECTED' });
  const row = rows.find((entry) => entry.id === id);
  if (!row) throw Object.assign(Error('父级身份不可读取，未推断显示路径。'), { code: 'NOT_FOUND' });
  seen.add(id);
  return [...(row.parentId ? graphPath(rows, row.parentId, seen) : []), row.name];
}
export function reprojectTree<T extends TreeRow>(rows: readonly T[], rootId: string): T[] {
  const descendants = descendantsById(rows, rootId);
  return rows.map((row) =>
    descendants.has(row.id) ? { ...row, path: graphPath(rows, row.id) } : row,
  );
}
export function projectLocationChange(
  locations: readonly ManagedLocation[],
  items: readonly DailyItemFacts[],
  id: string,
  change: { name?: string; parentId?: string | null },
): { locations: ManagedLocation[]; items: DailyItemFacts[] } {
  const root = locations.find((row) => row.id === id);
  const source = items.find((row) => row.item.id === id);
  if (!root || !source) throw Object.assign(Error('容器身份不可访问。'), { code: 'NOT_FOUND' });
  const next = reprojectTree(
    locations.map((row) =>
      row.id === id ? { ...row, ...change, revision: source.item.revision + 1 } : row,
    ),
    id,
  );
  const affected = descendantsById(next, id);
  const changed = items
    .filter(
      (row) => row.item.id === id || (row.item.location.id && affected.has(row.item.location.id)),
    )
    .map((row) => {
      const parentId =
        row.item.id === id ? next.find((entry) => entry.id === id)!.parentId : row.item.location.id;
      const parent = next.find((entry) => entry.id === parentId);
      return {
        ...structuredClone(row),
        item: {
          ...structuredClone(row.item),
          name: row.item.id === id ? (change.name ?? row.item.name) : row.item.name,
          revision: row.item.revision + (row.item.id === id ? 1 : 0),
          location: parentId
            ? {
                ...row.item.location,
                id: parentId,
                path: graphPath(next, parentId),
                label: parent!.name,
              }
            : { ...row.item.location, id: null, path: [], label: '位置未记录' },
        },
      };
    });
  return { locations: next, items: changed };
}
