import { keepPreviousData, useInfiniteQuery, type InfiniteData } from '@tanstack/react-query';
import { useResetCursorOnLeave } from './cursor.js';
import { useSession } from '../../lib/session.js';
import { ApiError, read } from '../../lib/api.js';
import { useConnection, useFeature } from './connection.js';
import type {
  CatalogQueryResultV2,
  CatalogQueryV2,
  HistoryQueryV2,
  HistoryResultV2,
  ItemQueryResultV2,
  ItemQueryV2,
} from '../../../../../packages/contracts/src/read-v2.js';

import { withoutUnsupportedCatalogQuery, withoutUnsupportedItemQuery } from './query-params.js';

type Cursor = string | undefined;

export function useItemQuery(
  input: Omit<ItemQueryV2, 'cursor'>,
  options: { enabled?: boolean; limit?: number; scopeKey?: string } = {},
) {
  const { features, context } = useConnection();
  const { session } = useSession();
  const prepared = withoutUnsupportedItemQuery(input, features);
  const limit = options.limit ?? prepared.limit ?? 100;
  const queryKey = [
    'items',
    session.cache_key,
    context?.household.id ?? session.household_id ?? 'pending',
    prepared,
    limit,
    options.scopeKey,
  ];
  useResetCursorOnLeave(queryKey);
  const query = useInfiniteQuery<
    ItemQueryResultV2,
    ApiError,
    InfiniteData<ItemQueryResultV2>,
    readonly unknown[],
    Cursor
  >({
    queryKey,
    queryFn: ({ pageParam, signal }) =>
      read<ItemQueryResultV2>(
        'query_items',
        {
          ...prepared,
          limit,
          ...(pageParam ? { cursor: pageParam } : {}),
        },
        signal,
      ),
    initialPageParam: undefined,
    getNextPageParam: (last) => last.next_cursor ?? undefined,
    enabled: options.enabled ?? true,
    retry: (count, error) => error.code !== 'INVALID_CURSOR' && count < 1,
    staleTime: 15_000,
    placeholderData: keepPreviousData,
  });
  return {
    ...query,
    items: query.data?.pages.flatMap((page) => page.data) ?? [],
    summary: query.data?.pages[0]?.summary,
    stale: query.data?.pages.some((page) => page.stale) ?? false,
    invalidCursor: query.error?.code === 'INVALID_CURSOR',
  };
}

export function useCatalogQuery(
  input: Omit<CatalogQueryV2, 'cursor'>,
  options: { enabled?: boolean; limit?: number } = {},
) {
  const { features, context } = useConnection();
  const { session } = useSession();
  const prepared = withoutUnsupportedCatalogQuery(input, features);
  const limit = options.limit ?? prepared.limit ?? 100;
  const queryKey = [
    'catalog',
    session.cache_key,
    context?.household.id ?? session.household_id ?? 'pending',
    prepared,
    limit,
  ];
  useResetCursorOnLeave(queryKey);
  const query = useInfiniteQuery<
    CatalogQueryResultV2,
    ApiError,
    InfiniteData<CatalogQueryResultV2>,
    readonly unknown[],
    Cursor
  >({
    queryKey,
    queryFn: ({ pageParam, signal }) =>
      read<CatalogQueryResultV2>(
        'query_catalog_nodes',
        {
          ...prepared,
          limit,
          ...(pageParam ? { cursor: pageParam } : {}),
        },
        signal,
      ),
    initialPageParam: undefined,
    getNextPageParam: (last) => last.next_cursor ?? undefined,
    enabled: options.enabled ?? true,
    retry: (count, error) => error.code !== 'INVALID_CURSOR' && count < 1,
    staleTime: 15_000,
    placeholderData: keepPreviousData,
  });
  return {
    ...query,
    nodes: query.data?.pages.flatMap((page) => page.data) ?? [],
    matchingCount: query.data?.pages[0]?.matching_count ?? 0,
    stale: query.data?.pages.some((page) => page.stale) ?? false,
    invalidCursor: query.error?.code === 'INVALID_CURSOR',
  };
}

export function useHistoryQuery(
  input: Omit<HistoryQueryV2, 'cursor'>,
  options: { enabled?: boolean; limit?: number } = {},
) {
  const { context } = useConnection();
  const { session } = useSession();
  const limit = options.limit ?? input.limit ?? 50;
  const queryKey = [
    'history-v2',
    session.cache_key,
    context?.household.id ?? session.household_id ?? 'pending',
    input,
    limit,
  ];
  useResetCursorOnLeave(queryKey);
  const query = useInfiniteQuery<
    HistoryResultV2,
    ApiError,
    InfiniteData<HistoryResultV2>,
    readonly unknown[],
    Cursor
  >({
    queryKey,
    queryFn: ({ pageParam, signal }) =>
      read<HistoryResultV2>(
        'get_history',
        {
          ...input,
          limit,
          ...(pageParam ? { cursor: pageParam } : {}),
        },
        signal,
      ),
    initialPageParam: undefined,
    getNextPageParam: (last) => last.next_cursor ?? undefined,
    enabled: options.enabled ?? true,
    retry: (count, error) => error.code !== 'INVALID_CURSOR' && count < 1,
    staleTime: 15_000,
    placeholderData: keepPreviousData,
  });
  return {
    ...query,
    events: query.data?.pages.flatMap((page) => page.data) ?? [],
    stale: query.data?.pages.some((page) => page.stale) ?? false,
  };
}

export function useHistoryFeature() {
  return useFeature('history_v2');
}
