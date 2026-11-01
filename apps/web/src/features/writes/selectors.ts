import { attr, isTerminal, type ItemRecord } from '../../../../../packages/contracts/src/web.js';
import type { CapabilityKey } from '../../../../../packages/contracts/src/read-v2.js';

/** Never derive profile defaults: only the server's resolved capabilities enable v2 fields. */
export function supportsCapability(
  record: unknown,
  capability: CapabilityKey,
  enabled: boolean,
): boolean {
  if (!enabled) return true; // Existing v1 command surface.
  if (!record || typeof record !== 'object' || !('effective_capabilities' in record)) return false;
  return (
    Array.isArray(record.effective_capabilities) &&
    record.effective_capabilities.includes(capability)
  );
}
export function writeCapabilities(item: ItemRecord | undefined, profileEnabled: boolean) {
  const active =
    !!item && !isTerminal(item) && !('record_state' in item && item.record_state === 'VOID');
  return {
    active,
    consume:
      active &&
      !!attr(item!, 'contents')?.remaining &&
      supportsCapability(item, 'contents', profileEnabled),
    open:
      active &&
      attr(item!, 'lifecycle')?.opening?.state !== 'OPENED' &&
      supportsCapability(item, 'lifecycle.opening', profileEnabled),
  };
}
