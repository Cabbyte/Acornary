-- Compatible with the existing application, which only writes result.operation_id.
SET LOCAL lock_timeout = '2s';
ALTER TABLE operations ADD COLUMN operation_id text;

CREATE FUNCTION bridge_operation_id() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
 IF jsonb_typeof(NEW.result->'operation_id') IS DISTINCT FROM 'string'
    OR (NEW.result->>'operation_id') !~ '^operation_[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$' THEN
  RAISE EXCEPTION 'result.operation_id must be a valid operation identifier' USING ERRCODE='23514';
 END IF;
 IF NEW.operation_id IS NULL THEN
  NEW.operation_id := NEW.result->>'operation_id';
 ELSIF NEW.operation_id IS DISTINCT FROM NEW.result->>'operation_id' THEN
  RAISE EXCEPTION 'operation_id must match result.operation_id' USING ERRCODE='23514';
 END IF;
 IF octet_length(NEW.result::text) > 4194304 THEN
  RAISE EXCEPTION 'operations.result exceeds 4 MiB' USING ERRCODE='23514';
 END IF;
 RETURN NEW;
END $$;
CREATE TRIGGER operations_insert_bridge BEFORE INSERT ON operations
 FOR EACH ROW EXECUTE FUNCTION bridge_operation_id();

CREATE FUNCTION guard_event_changes_size() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
 IF octet_length(NEW.changes::text) > 1048576 THEN
  RAISE EXCEPTION 'events.changes exceeds 1 MiB' USING ERRCODE='23514';
 END IF;
 RETURN NEW;
END $$;
CREATE TRIGGER events_insert_size BEFORE INSERT ON events
 FOR EACH ROW EXECUTE FUNCTION guard_event_changes_size();
