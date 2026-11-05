// Canonical UTC keys retain six fractional digits. Date parsing alone loses source microseconds.
export function utcTimestamp(value: string): string {
  const parsed = new Date(value);
  if (!Number.isFinite(parsed.getTime())) throw new Error('Invalid timestamp');
  const fraction = value.match(/\.(\d{1,6})(?:Z|[+-]\d{2}(?::?\d{2})?)$/)?.[1] ?? '';
  return parsed.toISOString().slice(0, 19) + '.' + fraction.padEnd(6, '0') + 'Z';
}
