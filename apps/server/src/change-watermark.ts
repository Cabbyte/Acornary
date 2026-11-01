import { query, type Client } from './db.js';

// Do not catch undefined_table inside a transaction: it would abort the read snapshot.
export async function currentChangeId(c: Client, householdId: string): Promise<string | 0> {
  const exists = (
    await query(c, "SELECT to_regclass('household_sync_state') IS NOT NULL AS present")
  ).rows[0].present;
  if (!exists) return 0;
  const row = (
    await query(
      c,
      'SELECT last_committed_change_id FROM household_sync_state WHERE household_id=$1',
      [householdId],
    )
  ).rows[0];
  if (!row) return 0;
  const value = String(row.last_committed_change_id);
  if (!/^(0|[1-9]\d*)$/.test(value)) throw new Error('Invalid household change watermark.');
  return value;
}
