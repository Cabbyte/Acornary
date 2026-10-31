import { query, type Client } from './db.js';
import type { DateFact } from '../../../packages/contracts/src/deadline.js';
import { DomainError } from '../../../packages/domain/src/index.js';

// Caller owns the transaction. The same household lock as writes prevents stale backfill overwrites.
export async function recomputeItemDates(c: Client, householdId: string, itemId: string) {
  await query(c, 'SELECT pg_advisory_xact_lock(hashtextextended($1,0))', [householdId]);
  await query(c, 'DELETE FROM date_facts WHERE household_id=$1 AND item_id=$2', [
    householdId,
    itemId,
  ]);
  await query(
    c,
    `INSERT INTO date_facts
    SELECT i.household_id,i.id,d.*,coalesce(s.last_committed_change_id,0)
    FROM items i JOIN households h ON h.id=i.household_id
    LEFT JOIN household_sync_state s ON s.household_id=i.household_id
    CROSS JOIN LATERAL acornary_item_date_sources(i.attributes,h.timezone) d
    WHERE i.household_id=$1 AND i.id=$2`,
    [householdId, itemId],
  );
}

// Backfill entry point: invoke inside db.transaction; no core writes, revisions or events.
export async function rebuildDateFacts(c: Client, householdId: string) {
  await query(c, 'SELECT pg_advisory_xact_lock(hashtextextended($1,0))', [householdId]);
  const items = await query(c, 'SELECT id FROM items WHERE household_id=$1 ORDER BY id', [
    householdId,
  ]);
  for (const item of items.rows) await recomputeItemDates(c, householdId, item.id);
  return items.rows.length;
}

// Fixed internal SQL aliases only. Fallback preserves legacy/imported items awaiting backfill.
export function itemDateRowsSql(item = 'o', household = 'h') {
  return `(SELECT source_key,entry_id,kind,due_on,basis,completed_on,source_template,source_version
    FROM date_facts WHERE household_id=${item}.household_id AND item_id=${item}.id
    UNION ALL SELECT * FROM acornary_item_date_sources(${item}.attributes,${household}.timezone)
    WHERE NOT EXISTS (SELECT 1 FROM date_facts WHERE household_id=${item}.household_id AND item_id=${item}.id))`;
}
export function dateStateSql(row = 'd', household = 'h') {
  return `(CASE WHEN ${row}.completed_on IS NOT NULL THEN 'COMPLETED'
    WHEN ${row}.due_on IS NULL THEN 'UNKNOWN'
    WHEN ${row}.due_on < (CURRENT_TIMESTAMP AT TIME ZONE acornary_date_timezone(${household}.timezone))::date THEN 'OVERDUE'
    WHEN ${row}.due_on = (CURRENT_TIMESTAMP AT TIME ZONE acornary_date_timezone(${household}.timezone))::date THEN 'DUE'
    ELSE 'UPCOMING' END)`;
}
export function itemDatesJsonSql(item = 'o', household = 'h') {
  return `(SELECT coalesce(jsonb_agg(to_jsonb(d) || jsonb_build_object('state',${dateStateSql('d', household)})
    ORDER BY d.due_on,d.source_key,d.entry_id),'[]'::jsonb) FROM ${itemDateRowsSql(item, household)} d)`;
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
