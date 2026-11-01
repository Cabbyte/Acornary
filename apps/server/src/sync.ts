import { query, type Client } from './db.js';

// Caller owns the transaction and must hold the household write lock before allocating IDs.
export async function recordSyncChange(
  c: Client,
  householdId: string,
  objectKind: 'ITEM' | 'CATALOG_NODE',
  objectId: string,
  revision: number,
  operationId: string,
): Promise<void> {
  // Keep bigint IDs in PostgreSQL throughout. New households acquire state on their first write.
  await query(
    c,
    `WITH change AS (
       INSERT INTO sync_changes(household_id,object_kind,object_id,revision,change_kind,operation_id,after_image)
       VALUES($1,$2,$3,$4,'UPSERT',$5,NULL)
       RETURNING household_id,change_id
     )
     INSERT INTO household_sync_state(household_id,last_committed_change_id)
     SELECT household_id,change_id FROM change WHERE true
     ON CONFLICT(household_id) DO UPDATE
     SET last_committed_change_id=GREATEST(household_sync_state.last_committed_change_id,excluded.last_committed_change_id)`,
    [householdId, objectKind, objectId, revision, operationId],
  );
}
