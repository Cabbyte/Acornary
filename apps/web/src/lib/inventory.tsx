import { createContext, useContext, useEffect, useState, type ReactNode } from 'react';
import { useQuery } from '@tanstack/react-query';
import type { InventorySnapshot } from '../../../../packages/contracts/src/web';
import { ApiError, snapshot } from './api';
import { persist, stored } from './storage';
import { useSession } from './session';
import { Button, Notice } from '../ui/components';

const Context = createContext<{
  data: InventorySnapshot;
  refresh: () => Promise<void>;
  stale: boolean;
  cacheWarning: string;
}>(null!);
export const useInventory = () => useContext(Context);
export function InventoryProvider({ children }: { children: ReactNode }) {
  const { session, online } = useSession();
  const key = session.cache_key!;
  const [cached, setCached] = useState<{ key: string; data: InventorySnapshot }>();
  const [cacheWarning, setCacheWarning] = useState('');
  const q = useQuery({
    queryKey: ['inventory', key],
    queryFn: snapshot,
    enabled: online,
    retry: false,
    staleTime: 30000,
  });
  useEffect(() => {
    let cancelled = false;
    void stored<InventorySnapshot>(`${key}:snapshot`)
      .then((data) => {
        if (!cancelled) setCached(data ? { key, data } : undefined);
      })
      .catch(() => setCacheWarning('本地缓存不可用，请保持联网。'));
    return () => {
      cancelled = true;
    };
  }, [key]);
  useEffect(() => {
    if (!q.data || localStorage.getItem('acornary-account') !== key) return;
    setCached({ key, data: q.data });
    void persist(`${key}:snapshot`, q.data).catch(() =>
      setCacheWarning('缓存空间不足，本次数据尚未保存在设备上。'),
    );
  }, [q.data, key]);
  const data = q.data ?? (cached?.key === key ? cached.data : undefined);
  if (!data)
    return (
      <main className="loading">
        <h1>我的物品</h1>
        {q.error || !online ? (
          <>
            <Notice danger>
              {q.error instanceof ApiError
                ? q.error.message
                : '当前离线，尚未缓存库存。请联网后打开一次。'}
            </Notice>
            <Button onClick={() => void q.refetch()}>重试</Button>
          </>
        ) : (
          <div role="status" className="skeleton">
            正在读取库存…
          </div>
        )}
      </main>
    );
  return (
    <Context.Provider
      value={{
        data,
        stale: !online || !!q.error,
        cacheWarning,
        refresh: async () => {
          const result = await q.refetch();
          if (result.error) throw result.error;
        },
      }}
    >
      {children}
    </Context.Provider>
  );
}
