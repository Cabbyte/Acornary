import { query, requireTransaction, type Client } from './db.js';
import { currentChangeId } from './change-watermark.js';
export function recordSyncChange(
  c: Client,
  householdId: string,
  objectKind: 'ITEM' | 'CATALOG_NODE' | 'NOTE' | 'ATTACHMENT',
  objectId: string,
  revision: number,
  operationId: string | null,
  changeKind: 'UPSERT' | 'TOMBSTONE' = 'UPSERT',
): void {
  requireTransaction(c);
  const next = BigInt(currentChangeId(c, householdId)) + 1n;
  if (next > 9223372036854775807n) throw new Error('Household sync cursor exhausted');
  const id = next.toString();
  query(
    c,
    'INSERT INTO household_sync_state(household_id,sync_generation,last_committed_change_id) VALUES(?1,?2,?3) ON CONFLICT(household_id) DO UPDATE SET last_committed_change_id=excluded.last_committed_change_id',
    [householdId, crypto.randomUUID(), id],
  );
  query(
    c,
    'INSERT INTO sync_changes(change_id,household_id,object_kind,object_id,revision,change_kind,operation_id,after_image) VALUES(?1,?2,?3,?4,?5,?6,?7,NULL)',
    [id, householdId, objectKind, objectId, revision, changeKind, operationId],
  );
  query(
    c,
    'INSERT INTO sync_object_versions(household_id,object_kind,object_id,last_change_id,change_kind) VALUES(?1,?2,?3,?4,?5) ON CONFLICT(household_id,object_kind,object_id) DO UPDATE SET last_change_id=excluded.last_change_id,change_kind=excluded.change_kind',
    [householdId, objectKind, objectId, id, changeKind],
  );
}
