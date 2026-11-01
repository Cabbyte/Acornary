import { createContext, useContext, useMemo, type ReactNode } from 'react';
import { useQuery } from '@tanstack/react-query';
import { read } from '../../lib/api';
import { useSession } from '../../lib/session';
import type {
  ConnectionContext,
  FeatureKey,
} from '../../../../../packages/contracts/src/read-v2.js';
import { SAFE_BASELINE, resolveFeatures } from './features.js';

interface ConnectionValue {
  context?: ConnectionContext;
  features: Set<FeatureKey>;
  protocolOk: boolean;
  loading: boolean;
}

const ConnectionContextValue = createContext<ConnectionValue>({
  features: new Set(SAFE_BASELINE),
  protocolOk: true,
  loading: false,
});

export function ConnectionProvider({ children }: { children: ReactNode }) {
  const { session } = useSession();
  const q = useQuery({
    queryKey: ['connection-context', session.cache_key ?? session.household_id ?? 'pending'],
    queryFn: () => read<ConnectionContext>('get_connection_context', {}),
    staleTime: 60_000,
    retry: false,
  });
  const features = useMemo(() => resolveFeatures(q.data), [q.data]);
  const protocolOk = !q.data?.protocol || q.data.protocol.current >= 2;
  return (
    <ConnectionContextValue.Provider
      value={{ context: q.data, features, protocolOk, loading: q.isLoading }}
    >
      {children}
    </ConnectionContextValue.Provider>
  );
}

export function useConnection() {
  return useContext(ConnectionContextValue);
}

export function useFeature(key: FeatureKey) {
  return useContext(ConnectionContextValue).features.has(key);
}

export function FeatureGate({
  feature,
  children,
  fallback = null,
}: {
  feature: FeatureKey;
  children: ReactNode;
  fallback?: ReactNode;
}) {
  return useFeature(feature) ? <>{children}</> : <>{fallback}</>;
}
