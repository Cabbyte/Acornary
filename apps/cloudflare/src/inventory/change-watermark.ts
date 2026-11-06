import { query, type Client } from './db.js';
export function currentChangeId(c: Client, householdId: string): string {
  const value =
    query(c, 'SELECT last_committed_change_id FROM household_sync_state WHERE household_id=?1', [
      householdId,
    ]).rows[0]?.last_committed_change_id ?? '0';
  if (!/^(0|[1-9]\d*)$/.test(value)) throw new Error('Invalid household change watermark');
  return value;
}
