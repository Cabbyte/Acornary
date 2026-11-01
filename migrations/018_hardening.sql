-- Inventory: service.ts, notes.ts, attachments.ts, terminal.ts, plugin.ts and scripts.
-- Deadline producers use ADD_DEADLINE etc.; no SYNC_RESET event producer exists.
-- Do not rewrite old audit rows. Any invalid historical row aborts this transaction.
SET LOCAL lock_timeout = '2s';
ALTER TABLE events ADD CONSTRAINT events_source_check CHECK(source IN
 ('WEB','MCP','MCP_UI','ANDROID','TERMINAL','IMPORT','SYSTEM','TEST','BENCHMARK','MIGRATION_TEST')) NOT VALID;
ALTER TABLE events ADD CONSTRAINT events_event_type_check CHECK(event_type IN
 ('CREATE','UPDATE','MOVE','OPEN','CONSUME_ITEMS','CONSUME_CONTENT','CORRECT',
  'ATTRIBUTE_BIND','ATTRIBUTE_UPDATE','ATTRIBUTE_REMOVE','ATTRIBUTE_UPGRADE','EDIT',
  'VOID','DISPOSE','SPLIT','NOTE_CREATE','NOTE_UPDATE','NOTE_ARCHIVE',
  'ATTACHMENT_ATTACH','ATTACHMENT_DETACH','ADD_DEADLINE','UPDATE_DEADLINE','REMOVE_DEADLINE','COMPLETE_DEADLINE')) NOT VALID;
ALTER TABLE events VALIDATE CONSTRAINT events_source_check;
ALTER TABLE events VALIDATE CONSTRAINT events_event_type_check;

-- Key-share locks keep a checked target alive until the inserting transaction ends.
-- The narrow helper runs as its owner so runtime can lock ACTOR rows without
-- gaining UPDATE rights on actors. No caller-provided SQL or schema resolution.
CREATE FUNCTION hardening_target_exists(h text, k text, i text) RETURNS boolean
LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path=public,pg_temp AS $$
BEGIN
 IF k='ITEM' THEN
  PERFORM 1 FROM items WHERE household_id=h AND id=i FOR KEY SHARE;
 ELSIF k='CATALOG_NODE' THEN
  PERFORM 1 FROM catalog_nodes WHERE household_id=h AND id=i FOR KEY SHARE;
 ELSIF k='NOTE' THEN
  PERFORM 1 FROM notes WHERE household_id=h AND id=i FOR KEY SHARE;
 ELSIF k='ACTOR' THEN
  PERFORM 1 FROM actors WHERE household_id=h AND id=i FOR KEY SHARE;
 ELSE RETURN false;
 END IF;
 RETURN FOUND;
END $$;

CREATE FUNCTION guard_event_target() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
 IF NEW.target_kind NOT IN ('ITEM','CATALOG_NODE') OR
    NOT hardening_target_exists(NEW.household_id,NEW.target_kind,NEW.target_id) THEN
  RAISE EXCEPTION 'Invalid event target' USING ERRCODE='23503', CONSTRAINT='events_target_guard';
 END IF;
 RETURN NEW;
END $$;
CREATE TRIGGER events_target_guard BEFORE INSERT ON events FOR EACH ROW EXECUTE FUNCTION guard_event_target();

-- Replace the existing file guard, retaining its trigger names and legacy bridge.
CREATE OR REPLACE FUNCTION check_file_target() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
 IF NEW.target_kind NOT IN ('ITEM','CATALOG_NODE','NOTE') OR
    (TG_TABLE_NAME='notes' AND NEW.target_kind='NOTE') OR
    NOT hardening_target_exists(NEW.household_id,NEW.target_kind,NEW.target_id) THEN
  RAISE EXCEPTION 'Invalid file target' USING ERRCODE='23503', CONSTRAINT=TG_NAME;
 END IF;
 RETURN NEW;
END $$;
CREATE FUNCTION guard_attribute_reference() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
 IF NEW.source_kind NOT IN ('ITEM','CATALOG_NODE') OR
    NEW.target_kind NOT IN ('ACTOR','ITEM','CATALOG_NODE') OR
    NOT hardening_target_exists(NEW.household_id,NEW.source_kind,NEW.source_id) OR
    NOT hardening_target_exists(NEW.household_id,NEW.target_kind,NEW.target_id) THEN
  RAISE EXCEPTION 'Invalid attribute reference' USING ERRCODE='23503', CONSTRAINT='attribute_references_guard';
 END IF;
 RETURN NEW;
END $$;
CREATE TRIGGER attribute_references_guard BEFORE INSERT OR UPDATE ON attribute_references
 FOR EACH ROW EXECUTE FUNCTION guard_attribute_reference();

-- Existing split FKs cover same-household source/child/receipt; the UNIQUE child
-- and positive quantity/self checks remain authoritative. One split has one source
-- and operation, and a source cannot be split again under a different split ID.
CREATE FUNCTION guard_item_split() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
 PERFORM pg_advisory_xact_lock(hashtextextended(NEW.household_id,0));
 IF EXISTS (SELECT 1 FROM item_splits s WHERE s.household_id=NEW.household_id AND
   ((s.split_id=NEW.split_id AND (s.source_item_id<>NEW.source_item_id OR s.operation_id<>NEW.operation_id OR s.basis<>NEW.basis OR s.unit<>NEW.unit)) OR
    (s.source_item_id=NEW.source_item_id AND s.split_id<>NEW.split_id))) THEN
  RAISE EXCEPTION 'Inconsistent split provenance' USING ERRCODE='23514', CONSTRAINT='item_splits_guard';
 END IF;
 RETURN NEW;
END $$;
CREATE TRIGGER item_splits_guard BEFORE INSERT ON item_splits FOR EACH ROW EXECUTE FUNCTION guard_item_split();
CREATE FUNCTION reject_hardening_mutation() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
 RAISE EXCEPTION 'Append-only relation' USING ERRCODE='23514', CONSTRAINT=TG_NAME;
END $$;
DROP TRIGGER immutable_events ON events;
CREATE TRIGGER immutable_events BEFORE UPDATE OR DELETE ON events FOR EACH ROW EXECUTE FUNCTION reject_hardening_mutation();
CREATE TRIGGER immutable_item_splits BEFORE UPDATE OR DELETE ON item_splits FOR EACH ROW EXECUTE FUNCTION reject_hardening_mutation();

-- Trigger installation alone cannot validate historical rows. Preflight all covered
-- targets and split groups in the same migration transaction; never repair by deletion.
DO $$ DECLARE t text; bad boolean; BEGIN
 FOREACH t IN ARRAY ARRAY['events','notes','attachments','upload_sessions'] LOOP
  EXECUTE format('SELECT EXISTS(SELECT 1 FROM %I WHERE NOT hardening_target_exists(household_id,target_kind,target_id))',t) INTO bad;
  IF bad THEN RAISE EXCEPTION 'Hardening preflight failed: % targets',t; END IF;
 END LOOP;
 IF EXISTS (SELECT 1 FROM attribute_references WHERE
   NOT hardening_target_exists(household_id,source_kind,source_id) OR
   NOT hardening_target_exists(household_id,target_kind,target_id)) THEN
  RAISE EXCEPTION 'Hardening preflight failed: attribute references';
 END IF;
 IF EXISTS (SELECT 1 FROM item_splits GROUP BY household_id,split_id
   HAVING count(DISTINCT source_item_id)>1 OR count(DISTINCT operation_id)>1 OR count(DISTINCT basis)>1 OR count(DISTINCT unit)>1) OR
    EXISTS (SELECT 1 FROM item_splits GROUP BY household_id,source_item_id HAVING count(DISTINCT split_id)>1) THEN
  RAISE EXCEPTION 'Hardening preflight failed: split provenance';
 END IF;
END $$;

-- No scheduler or new runtime DDL rights. Apply after creating the runtime role
-- as well when provisioning a deployment whose role does not exist yet.
DO $$ BEGIN
 IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname='acornary_app') THEN
  GRANT SELECT ON catalog_policy_versions,catalog_proposals,catalog_identity_keys,
   notes,attachments,attachment_blobs,upload_sessions,sensitive_access_audit,
   item_splits,attribute_references TO acornary_app;
  GRANT INSERT,UPDATE ON attachments,attachment_blobs,upload_sessions TO acornary_app;
  GRANT INSERT ON sensitive_access_audit TO acornary_app;
  GRANT USAGE ON SEQUENCE sensitive_access_audit_id_seq TO acornary_app;
  REVOKE UPDATE,DELETE ON events,item_splits FROM acornary_app;
 END IF;
END $$;
