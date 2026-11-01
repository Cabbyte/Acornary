-- acornary:no-transaction
-- A top-level DO can commit bounded batches. The checkpoint and each batch of
-- operation_id updates commit together; all historical payloads remain untouched.
DO $$
DECLARE
 progress jsonb;
 last_key text[];
 upper_key text[];
 next_key text[];
BEGIN
 SELECT checkpoint INTO progress FROM migrations WHERE name='009_02_operation_backfill.sql';
 IF progress IS NULL THEN
  SELECT ARRAY[household_id,actor_id,idempotency_key] INTO upper_key FROM operations
   ORDER BY household_id DESC,actor_id DESC,idempotency_key DESC LIMIT 1;
  progress := jsonb_build_object('upper',upper_key,'last',NULL);
  UPDATE migrations SET checkpoint=progress WHERE name='009_02_operation_backfill.sql';
  COMMIT;
 ELSE
  SELECT array_agg(value ORDER BY ordinality) INTO upper_key
   FROM jsonb_array_elements_text(NULLIF(progress->'upper','null'::jsonb)) WITH ORDINALITY;
  SELECT array_agg(value ORDER BY ordinality) INTO last_key
   FROM jsonb_array_elements_text(NULLIF(progress->'last','null'::jsonb)) WITH ORDINALITY;
 END IF;
 LOOP
  PERFORM set_config('lock_timeout','2s',true);
  WITH batch AS (
   SELECT household_id,actor_id,idempotency_key FROM operations
   WHERE operation_id IS NULL
    AND (household_id,actor_id,idempotency_key) <= (upper_key[1],upper_key[2],upper_key[3])
    AND (last_key IS NULL OR (household_id,actor_id,idempotency_key) > (last_key[1],last_key[2],last_key[3]))
   ORDER BY household_id,actor_id,idempotency_key LIMIT 1000
  ), updated AS (
   UPDATE operations o SET operation_id=o.result->>'operation_id' FROM batch b
   WHERE (o.household_id,o.actor_id,o.idempotency_key)=(b.household_id,b.actor_id,b.idempotency_key)
    AND o.operation_id IS NULL
   RETURNING o.household_id,o.actor_id,o.idempotency_key
  )
  SELECT ARRAY[household_id,actor_id,idempotency_key] INTO next_key FROM updated
   ORDER BY household_id DESC,actor_id DESC,idempotency_key DESC LIMIT 1;
  EXIT WHEN next_key IS NULL;
  -- Reject corrupt historical identifiers instead of manufacturing replacements.
  IF EXISTS (SELECT 1 FROM operations
   WHERE (household_id,actor_id,idempotency_key) <= (next_key[1],next_key[2],next_key[3])
    AND (last_key IS NULL OR (household_id,actor_id,idempotency_key) > (last_key[1],last_key[2],last_key[3]))
    AND (operation_id IS NULL OR jsonb_typeof(result->'operation_id') IS DISTINCT FROM 'string'
     OR operation_id !~ '^operation_[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$'
     OR operation_id IS DISTINCT FROM result->>'operation_id')) THEN
   RAISE EXCEPTION 'Invalid historical operation identifier; manual repair required' USING ERRCODE='23514';
  END IF;
  last_key := next_key;
  UPDATE migrations SET checkpoint=jsonb_build_object('upper',upper_key,'last',last_key)
   WHERE name='009_02_operation_backfill.sql';
  COMMIT;
 END LOOP;
END $$;
