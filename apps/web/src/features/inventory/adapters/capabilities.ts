const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null;

const strings = (value: unknown): string[] =>
  Array.isArray(value) ? value.filter((entry): entry is string => typeof entry === 'string') : [];

export function effectiveCapabilities(record: {
  effective_capabilities?: string[];
  metadata?: unknown;
}): string[] {
  if (Array.isArray(record.effective_capabilities)) return strings(record.effective_capabilities);
  if (isRecord(record.metadata)) return strings(record.metadata.effective_capabilities);
  return [];
}

export function hasCapability(
  view:
    | { capabilities?: readonly string[] | null; effectiveCapabilities?: readonly string[] }
    | null
    | undefined,
  key: string,
): boolean {
  if (!view) return false;
  if (Array.isArray(view.effectiveCapabilities)) return view.effectiveCapabilities.includes(key);
  if (Array.isArray(view.capabilities)) return view.capabilities.includes(key);
  return false;
}
