import type {
  ConnectionContext,
  FeatureKey,
} from '../../../../../packages/contracts/src/read-v2.js';

export const SAFE_BASELINE: FeatureKey[] = ['query_v2', 'history_v2'];

// Server features describe domain support; the iframe only exposes capabilities
// for which it has a complete UI and transport. Web retains the server feature set.
const unsupportedInPlugin = new Set<FeatureKey>([
  'stock',
  'void',
  'split',
  'references',
  'attachments',
]);
export function resolveFeatures(
  ctx: ConnectionContext | undefined,
  host?: 'web' | 'mcp',
): Set<FeatureKey> {
  return new Set(
    [...SAFE_BASELINE, ...(ctx?.features ?? [])].filter(
      (feature) => host !== 'mcp' || !unsupportedInPlugin.has(feature),
    ),
  );
}
