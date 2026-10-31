-- TEST-ONLY minimal SQL reference. Never discovered by the production migrator.
-- It proves selected database mechanics; it is NOT the Batch 1 implementation.
CREATE TABLE operations (
 household_id text NOT NULL, operation_id text NOT NULL, result jsonb NOT NULL,
 UNIQUE(household_id,operation_id),
 CHECK(result ? 'operation_id' AND jsonb_typeof(result->'operation_id')='string' AND operation_id=result->>'operation_id')
);
CREATE TABLE events (
 id text PRIMARY KEY, household_id text NOT NULL, operation_id text NOT NULL,
 FOREIGN KEY(household_id,operation_id) REFERENCES operations(household_id,operation_id)
 DEFERRABLE INITIALLY DEFERRED
);
CREATE TABLE nodes (
 id text PRIMARY KEY, household_id text NOT NULL, parent_id text, can_contain boolean NOT NULL DEFAULT true,
 UNIQUE(household_id,id), FOREIGN KEY(household_id,parent_id) REFERENCES nodes(household_id,id)
);
CREATE FUNCTION guard_tree() RETURNS trigger LANGUAGE plpgsql VOLATILE AS $$
DECLARE parent_capability boolean;
BEGIN
 PERFORM pg_advisory_xact_lock(hashtextextended(NEW.household_id,0));
 IF current_setting('transaction_isolation') <> 'read committed' THEN
  RAISE EXCEPTION 'UNSUPPORTED_WRITE_ISOLATION';
 END IF;
 IF TG_OP='UPDATE' AND (NEW.id IS DISTINCT FROM OLD.id OR NEW.household_id IS DISTINCT FROM OLD.household_id) THEN
  RAISE EXCEPTION 'IMMUTABLE_IDENTITY';
 END IF;
 IF NOT NEW.can_contain AND EXISTS(SELECT 1 FROM nodes WHERE household_id=NEW.household_id AND parent_id=NEW.id) THEN
  RAISE EXCEPTION 'TEMPLATE_IN_USE';
 END IF;
 IF NEW.parent_id IS NOT NULL THEN
  SELECT can_contain INTO parent_capability FROM nodes WHERE household_id=NEW.household_id AND id=NEW.parent_id;
  IF parent_capability IS DISTINCT FROM true THEN RAISE EXCEPTION 'INVALID_PARENT'; END IF;
  IF EXISTS(WITH RECURSIVE a AS (
    SELECT id,parent_id FROM nodes WHERE household_id=NEW.household_id AND id=NEW.parent_id
    UNION SELECT n.id,n.parent_id FROM nodes n JOIN a ON n.id=a.parent_id WHERE n.household_id=NEW.household_id
   ) SELECT 1 FROM a WHERE id=NEW.id) THEN RAISE EXCEPTION 'CYCLE_DETECTED'; END IF;
 END IF;
 RETURN NEW;
END $$;
CREATE TRIGGER node_guard BEFORE INSERT OR UPDATE ON nodes FOR EACH ROW EXECUTE FUNCTION guard_tree();
CREATE TABLE sync_changes(change_id bigserial PRIMARY KEY,household_id text NOT NULL,object_id text NOT NULL);
CREATE TABLE sync_state(household_id text PRIMARY KEY,watermark bigint NOT NULL DEFAULT 0,pruned_through bigint NOT NULL DEFAULT 0);
