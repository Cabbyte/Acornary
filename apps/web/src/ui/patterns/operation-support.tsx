import { createContext, useContext, type ReactNode } from 'react';
import type { OperationPresentation } from './types';
/** Optional host-owned help/review content. No storage or application dependency. */
export const OperationSupportContext = createContext<
  ((operation: OperationPresentation) => ReactNode) | null
>(null);
export const useOperationSupport = () => useContext(OperationSupportContext);
