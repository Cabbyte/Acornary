import { query, type Client } from './db.js';
import type { DateFact } from '../../../../packages/contracts/src/deadline.js';
import { DomainError } from '../../../../packages/domain/src/index.js';
import { currentChangeId } from './change-watermark.js';
export function householdDay(time: Date | string, zone: string): string {
  let format: Intl.DateTimeFormat;
  try {
    format = new Intl.DateTimeFormat('en-CA', {
      timeZone: zone,
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
    });
  } catch {
    format = new Intl.DateTimeFormat('en-CA', {
      timeZone: 'UTC',
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
    });
  }
  const parts = Object.fromEntries(
    format.formatToParts(new Date(time)).map((p) => [p.type, p.value]),
  );
  return `${parts.year}-${parts.month}-${parts.day}`;
}
export function dateSources(attributes: any[], zone: string): any[] {
  const rows: any[] = [];
  for (const a of attributes) {
    const base = {
      source_template: a.template_id,
      source_version: a.template_version,
      completed_on: null,
      entry_id: '',
    };
    if (a.template_id === 'lifecycle') {
      if (a.values.expiry?.date)
        rows.push({
          ...base,
          source_key: 'lifecycle.expiry',
          kind: 'EXPIRY',
          due_on: a.values.expiry.date,
          basis: 'lifecycle.expiry.date',
        });
      if (a.values.opening?.opened_at && a.values.expiry?.after_opening_days != null)
        rows.push({
          ...base,
          source_key: 'lifecycle.opening',
          kind: 'EXPIRY',
          due_on: advanceDeadline(
            householdDay(a.values.opening.opened_at, zone),
            a.values.expiry.after_opening_days,
          ),
          basis: 'lifecycle.opening.opened_at + lifecycle.expiry.after_opening_days',
        });
    } else if (a.template_id === 'deadline')
      for (const e of a.values.entries ?? [])
        rows.push({
          ...base,
          source_key: 'deadline',
          entry_id: e.id,
          kind: e.kind,
          due_on: e.due_on,
          basis: e.basis ?? null,
          completed_on: e.recurrence_days == null ? (e.last_completed_on ?? null) : null,
        });
  }
  return rows.sort(
    (a, b) =>
      a.due_on.localeCompare(b.due_on) ||
      a.source_key.localeCompare(b.source_key) ||
      a.entry_id.localeCompare(b.entry_id),
  );
}
export function itemDates(c: Client, household: string, id: string, attributes: any[]) {
  const zone = query(c, 'SELECT timezone FROM households WHERE id=?1', [household]).rows[0]
    .timezone;
  const today = householdDay(new Date(), zone);
  return dateSources(attributes, zone).map((d) => ({
    ...d,
    state: d.completed_on
      ? 'COMPLETED'
      : !d.due_on
        ? 'UNKNOWN'
        : d.due_on < today
          ? 'OVERDUE'
          : d.due_on === today
            ? 'DUE'
            : 'UPCOMING',
  }));
}
export function recomputeItemDates(c: Client, household: string, id: string) {
  const row = query(c, 'SELECT attributes FROM items WHERE household_id=?1 AND id=?2', [
    household,
    id,
  ]).rows[0];
  query(c, 'DELETE FROM date_facts WHERE household_id=?1 AND item_id=?2', [household, id]);
  if (!row) return;
  for (const d of itemDates(c, household, id, row.attributes))
    query(
      c,
      'INSERT INTO date_facts(household_id,item_id,source_key,entry_id,kind,due_on,basis,completed_on,source_template,source_version,projected_through_change_id) VALUES(?1,?2,?3,?4,?5,?6,?7,?8,?9,?10,?11)',
      [
        household,
        id,
        d.source_key,
        d.entry_id,
        d.kind,
        d.due_on,
        d.basis,
        d.completed_on,
        d.source_template,
        d.source_version,
        currentChangeId(c, household),
      ],
    );
}
export function rebuildDateFacts(c: Client, household: string) {
  const items = query(c, 'SELECT id FROM items WHERE household_id=?1 ORDER BY id', [
    household,
  ]).rows;
  for (const i of items) recomputeItemDates(c, household, i.id);
  return items.length;
}
const labels: Record<DateFact['kind'], string> = {
  EXPIRY: '保质期',
  WARRANTY_END: '保修到期',
  SERVICE_DUE: '维护到期',
  RETURN_BY: '应还',
  RENEWAL: '续期',
  REORDER_BY: '补货',
};
export function dateView(rows: any[], attributes: any[]) {
  const lifecycle = attributes.find((a) => a.template_id === 'lifecycle')?.values;
  const dates: DateFact[] = (rows ?? []).map((row) => ({
    key: row.source_key === 'deadline' ? `deadline.${row.entry_id}` : row.source_key,
    source: row.source_template === 'deadline' ? 'DEADLINE' : 'LIFECYCLE',
    kind: row.kind,
    ...(row.source_key === 'lifecycle.expiry' && lifecycle?.expiry?.date_kind
      ? { date_kind: lifecycle.expiry.date_kind }
      : {}),
    due_on: row.due_on,
    basis: row.basis,
    state: row.state,
    completed_on: row.completed_on,
    label:
      row.source_key === 'lifecycle.opening' ? '开封后期限' : labels[row.kind as DateFact['kind']],
  }));
  const actionable = dates.filter((d) => d.state !== 'COMPLETED');
  const reminder_date = actionable.map((d) => d.due_on).sort()[0] ?? null;
  // Keep the existing reminder object and its lifecycle basis ordering for old consumers.
  const basis = [...actionable]
    .sort((a, b) => a.key.localeCompare(b.key))
    .map((d) => d.basis ?? d.key);
  return {
    dates,
    reminder_date,
    reminder: { ...(reminder_date ? { date: reminder_date } : {}), basis },
  };
}

// completed_on already denotes a household calendar day: UTC is only a calendar arithmetic carrier.
export function advanceDeadline(completedOn: string, days: number): string {
  const date = new Date(`${completedOn}T00:00:00Z`);
  date.setUTCDate(date.getUTCDate() + days);
  const result = date.toISOString().slice(0, 10);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(result))
    throw new DomainError(
      'ATTRIBUTE_VALIDATION_FAILED',
      'Recurring deadline exceeds the supported date range.',
    );
  return result;
}
