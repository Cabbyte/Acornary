import type {
  ItemQueryV2,
  ItemQueryResultV2,
  CatalogQueryV2,
  CatalogQueryResultV2,
  HistoryQueryV2,
  HistoryResultV2,
} from '../../../../packages/contracts/src/read-v2';
import {
  withoutUnsupportedItemQuery,
  withoutUnsupportedCatalogQuery,
} from '../features/api/query-params';
import { sameGeneration, scopeKey, type ApplicationScope } from './scope';
export { withoutUnsupportedItemQuery, withoutUnsupportedCatalogQuery };
export interface ApplicationQueries {
  items(
    scope: ApplicationScope,
    input: ItemQueryV2,
    signal: AbortSignal,
  ): Promise<ItemQueryResultV2>;
  catalog(
    scope: ApplicationScope,
    input: CatalogQueryV2,
    signal: AbortSignal,
  ): Promise<CatalogQueryResultV2>;
  history(
    scope: ApplicationScope,
    input: HistoryQueryV2,
    signal: AbortSignal,
  ): Promise<HistoryResultV2>;
}
export type QueryCoverage = 'complete' | 'partial' | 'none';
export interface FactPage<T> {
  data: readonly T[];
  coverage: QueryCoverage;
  knownTotal: number | null;
  pageIndex: number;
  pageSize: number;
  hasPrevious: boolean;
  hasNext: boolean;
}
/** Projection for an explicitly supplied local snapshot; never claims server coverage. */
export function projectSnapshotPage<T>(
  rows: readonly T[],
  pageIndex: number,
  pageSize: number,
  coverage: QueryCoverage,
): FactPage<T> {
  const size = Math.max(1, Math.floor(pageSize));
  const index = Math.min(
    Math.max(0, Math.floor(pageIndex) || 0),
    Math.max(0, Math.ceil(rows.length / size) - 1),
  );
  return {
    data: rows.slice(index * size, (index + 1) * size),
    coverage,
    knownTotal: coverage === 'complete' ? rows.length : null,
    pageIndex: index,
    pageSize: size,
    hasPrevious: index > 0,
    hasNext: (index + 1) * size < rows.length,
  };
}
export const scopedQueryKey = (scope: ApplicationScope, resource: string, input: unknown) =>
  [scopeKey(scope), scope.generation, resource, input] as const;
export async function readInScope<T>(
  scope: ApplicationScope,
  current: () => ApplicationScope,
  read: () => Promise<T>,
): Promise<T> {
  const result = await read();
  if (!sameGeneration(scope, current())) throw Error('SESSION_CHANGED');
  return result;
}
export const writeInvalidations = [
  'items',
  'catalog',
  'history-v2',
  'item-detail',
  'notes',
] as const;
