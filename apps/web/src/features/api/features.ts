import type {
  ConnectionContext,
  FeatureKey,
} from '../../../../../packages/contracts/src/read-v2.js';

export const SAFE_BASELINE: FeatureKey[] = ['query_v2', 'history_v2'];

export function resolveFeatures(ctx: ConnectionContext | undefined): Set<FeatureKey> {
  if (!ctx?.features) return new Set(SAFE_BASELINE);
  return new Set([...SAFE_BASELINE, ...ctx.features]);
}
