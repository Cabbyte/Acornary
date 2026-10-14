export function reminderDate(lifecycle: any, timezone: string): { date?: string; basis: string[] } {
  const dates: string[] = [];
  const basis: string[] = [];
  if (lifecycle?.expiry?.date) {
    dates.push(lifecycle.expiry.date);
    basis.push('lifecycle.expiry.date');
  }
  if (lifecycle?.opening?.opened_at && lifecycle?.expiry?.after_opening_days) {
    const parts = new Intl.DateTimeFormat('en-CA', {
      timeZone: timezone,
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
    }).formatToParts(new Date(lifecycle.opening.opened_at));
    const part = (type: string) => parts.find((p) => p.type === type)!.value;
    const d = new Date(`${part('year')}-${part('month')}-${part('day')}T00:00:00Z`);
    d.setUTCDate(d.getUTCDate() + lifecycle.expiry.after_opening_days);
    dates.push(d.toISOString().slice(0, 10));
    basis.push('lifecycle.opening.opened_at + lifecycle.expiry.after_opening_days');
  }
  return { ...(dates.length ? { date: dates.sort()[0] } : {}), basis };
}
