import { useEffect, useRef } from 'react';
import { useQueryClient, type InfiniteData, type QueryKey } from '@tanstack/react-query';

/** Changing filters starts at page one; detail navigation retains the loaded pages. */
export function useResetCursorOnLeave(queryKey: QueryKey) {
  const client = useQueryClient();
  const signature = JSON.stringify(queryKey);
  const previous = useRef({ signature, queryKey });
  useEffect(() => {
    if (previous.current.signature !== signature) {
      client.setQueryData<InfiniteData<unknown>>(previous.current.queryKey, (data) =>
        data
          ? { ...data, pages: data.pages.slice(0, 1), pageParams: data.pageParams.slice(0, 1) }
          : data,
      );
      previous.current = { signature, queryKey };
    }
  }, [client, signature]);
}
