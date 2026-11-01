import type { CatalogQueryV2, ItemQueryV2 } from '../../../../../packages/contracts/src/read-v2.js';

export function withoutUnsupportedItemQuery(
  input: Omit<ItemQueryV2, 'cursor'>,
  features: Set<string>,
): Omit<ItemQueryV2, 'cursor'> {
  const next = { ...input };
  if (!features.has('profile_capabilities')) {
    delete next.profile;
    delete next.capabilities;
  }
  if (!features.has('deadline')) delete next.date_filters;
  if (!features.has('void')) delete next.include_void;
  if (!features.has('split')) delete next.include_terminal;
  return next;
}

export function withoutUnsupportedCatalogQuery(
  input: Omit<CatalogQueryV2, 'cursor'>,
  features: Set<string>,
): Omit<CatalogQueryV2, 'cursor'> {
  const next = { ...input };
  if (!features.has('profile_capabilities')) {
    delete next.profile;
    delete next.capabilities;
  }
  return next;
}
