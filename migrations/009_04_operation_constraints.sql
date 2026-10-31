SET LOCAL lock_timeout = '2s';
ALTER TABLE operations ADD CONSTRAINT operations_household_operation_unique
 UNIQUE USING INDEX operations_household_operation_unique;
ALTER TABLE events ADD CONSTRAINT events_operation_fk
 FOREIGN KEY (household_id,operation_id) REFERENCES operations(household_id,operation_id)
 DEFERRABLE INITIALLY DEFERRED NOT VALID;
ALTER TABLE operations ADD CONSTRAINT operations_operation_id_consistent CHECK (
 operation_id IS NOT NULL
 AND jsonb_typeof(result->'operation_id') IS NOT DISTINCT FROM 'string'
 AND operation_id ~ '^operation_[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$'
 AND operation_id IS NOT DISTINCT FROM result->>'operation_id'
) NOT VALID;
