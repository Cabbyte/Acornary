/** v0.13.0 inherited the SKU's category as an intake location. Only repair an
 * untouched inherited value before submission; an uncertain attempt must retain
 * its exact original parameters and idempotency key for recovery. */
export function repairIntakeLocation<
  T extends {
    values: Record<string, string>;
    original: Record<string, string>;
    attempt?: unknown;
    result?: unknown;
  },
>(draft: T, categoryId: string | null): T {
  if (
    draft.attempt ||
    draft.result ||
    !categoryId?.startsWith('catalog_node_') ||
    draft.values.parent !== categoryId ||
    draft.original.parent !== categoryId
  )
    return draft;
  return {
    ...draft,
    values: { ...draft.values, parent: '' },
    original: { ...draft.original, parent: '' },
  };
}
