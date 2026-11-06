import { NativeDatabase } from './inventory/db.js';
export function nextMaintenance(db: NativeDatabase, minimumDelay = 300000): number | null {
  if (db.query('SELECT status FROM cf_store_state WHERE singleton=1').rows[0]?.status !== 'ACTIVE')
    return null;
  const due = db.query(
    `SELECT MIN(CASE WHEN kind='UPLOAD_RECONCILE' THEN json_extract(payload,'$.not_before') ELSE '1970-01-01T00:00:00Z' END) AS due FROM cf_outbox WHERE delivered_at IS NULL AND kind IN ('DIRECTORY_PROJECT','UPLOAD_RECONCILE')`,
  ).rows[0]?.due;
  return due ? Math.max(Date.now() + minimumDelay, Date.parse(due)) : null;
}
export type MaintenancePlan = {
  household_id: string | null;
  objects: { id: string; storage_key: string }[];
};
export function maintenancePlan(db: NativeDatabase): MaintenancePlan {
  return db.transaction(() => {
    const state = db.query('SELECT * FROM cf_store_state WHERE singleton=1').rows[0];
    if (state?.status !== 'ACTIVE')
      return { household_id: null, objects: [] as { id: string; storage_key: string }[] };
    const now = new Date().toISOString(),
      objects: { id: string; storage_key: string }[] = [];
    for (const row of db.query(
      "SELECT id,payload FROM cf_outbox WHERE delivered_at IS NULL AND kind='UPLOAD_RECONCILE' AND json_extract(payload,'$.not_before')<=?1 ORDER BY created_at,id LIMIT 100",
      [now],
    ).rows) {
      const attempt = db.query('SELECT * FROM cf_upload_attempts WHERE lease_id=?1', [row.id])
        .rows[0];
      if (!attempt || attempt.state === 'CONFIRMED') {
        db.query('UPDATE cf_outbox SET delivered_at=?1 WHERE id=?2', [now, row.id]);
        continue;
      }
      if (attempt.lease_expires_at > now) continue;
      // A terminal lease state prevents late confirmation from racing the external R2 deletion.
      db.query("UPDATE cf_upload_attempts SET state='CLEANED' WHERE lease_id=?1", [row.id]);
      if (
        db.query('SELECT 1 FROM attachment_blobs WHERE storage_key=?1 OR thumbnail_key=?1', [
          attempt.storage_key,
        ]).rowCount
      )
        throw new Error('Refusing to clean a referenced upload object');
      objects.push({ id: row.id, storage_key: attempt.storage_key });
    }
    db.query('DELETE FROM frozen_exports WHERE expires_at<=?1', [now]);
    return { household_id: state.household_id as string, objects };
  });
}
export function acknowledgeCleanup(db: NativeDatabase, id: string) {
  db.transaction(() => {
    if (
      db.query('SELECT state FROM cf_upload_attempts WHERE lease_id=?1', [id]).rows[0]?.state !==
      'CLEANED'
    )
      throw new Error('Cleanup lease is not terminal');
    db.query(
      "UPDATE cf_outbox SET delivered_at=(SELECT now FROM cf_clock) WHERE id=?1 AND kind='UPLOAD_RECONCILE'",
      [id],
    );
  });
}
