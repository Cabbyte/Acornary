import { useEffect } from 'react';
import { useQueryClient, type InfiniteData, type QueryKey } from '@tanstack/react-query';

/** Returning to a prior filter starts with its first page, never a retained opaque cursor. */
export function useResetCursorOnLeave(queryKey: QueryKey) {
  const client = useQueryClient();
  const signature = JSON.stringify(queryKey);
  useEffect(
    () => () => {
      client.setQueryData<InfiniteData<unknown>>(queryKey, (previous) =>
        previous
          ? {
              ...previous,
              pages: previous.pages.slice(0, 1),
              pageParams: previous.pageParams.slice(0, 1),
            }
          : previous,
      );
      // Query keys are serializable values; reconstructed objects are intentionally equivalent.
    },
    [client, signature],
  );
}
