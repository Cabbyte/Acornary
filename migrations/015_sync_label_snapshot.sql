-- Expand only: online history backfill is checkpointed by label-projection.ts.
ALTER TABLE items ADD COLUMN label_hash text,
 ADD COLUMN label_updated_at timestamptz,
 ADD COLUMN projected_through_change_id bigint NOT NULL DEFAULT 0;
CREATE INDEX items_missing_label ON items(household_id,id) WHERE label_hash IS NULL;

-- Persist object watermarks across log pruning; core revision is not a projection version.
CREATE TABLE sync_object_versions (
 household_id text NOT NULL REFERENCES households(id), object_kind text NOT NULL,
 object_id text NOT NULL, last_change_id bigint NOT NULL, change_kind text NOT NULL,
 PRIMARY KEY(household_id,object_kind,object_id)
);
INSERT INTO sync_object_versions
 SELECT DISTINCT ON (household_id,object_kind,object_id)
 household_id,object_kind,object_id,change_id,change_kind FROM sync_changes
 ORDER BY household_id,object_kind,object_id,change_id DESC;
ALTER TABLE sync_changes DROP CONSTRAINT sync_changes_object_kind_check;
ALTER TABLE sync_changes ADD CHECK(object_kind IN ('ITEM','CATALOG_NODE','NOTE','ATTACHMENT'));
ALTER TABLE sync_changes ADD CHECK(after_image IS NULL);
CREATE FUNCTION capture_sync_object_version() RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER
 SET search_path=public,pg_temp AS $$
BEGIN
 INSERT INTO sync_object_versions VALUES(NEW.household_id,NEW.object_kind,NEW.object_id,NEW.change_id,NEW.change_kind)
 ON CONFLICT(household_id,object_kind,object_id) DO UPDATE
 SET last_change_id=excluded.last_change_id,change_kind=excluded.change_kind
 WHERE sync_object_versions.last_change_id < excluded.last_change_id;
 RETURN NEW;
END $$;
CREATE TRIGGER sync_object_version AFTER INSERT ON sync_changes
 FOR EACH ROW EXECUTE FUNCTION capture_sync_object_version();

-- Maintenance is explicit, household locked, and removes only a continuous old prefix.
-- PUBLIC cannot invoke administrative pruning/reset functions.
CREATE FUNCTION prune_household_sync(h text) RETURNS bigint LANGUAGE plpgsql AS $$
DECLARE boundary bigint;
BEGIN
 PERFORM pg_advisory_xact_lock(hashtextextended(h,0));
 SELECT coalesce(max(change_id),0) INTO boundary FROM sync_changes
 WHERE household_id=h AND created_at < now()-interval '30 days'
 AND change_id < coalesce((SELECT min(change_id) FROM sync_changes
   WHERE household_id=h AND created_at >= now()-interval '30 days'),9223372036854775807);
 DELETE FROM sync_changes WHERE household_id=h AND change_id <= boundary;
 UPDATE household_sync_state SET pruned_through_change_id=greatest(pruned_through_change_id,boundary)
 WHERE household_id=h;
 RETURN boundary;
END $$;
CREATE FUNCTION reset_household_sync(h text) RETURNS uuid LANGUAGE plpgsql AS $$
DECLARE generation uuid;
BEGIN
 PERFORM pg_advisory_xact_lock(hashtextextended(h,0));
 INSERT INTO household_sync_state(household_id) VALUES(h) ON CONFLICT DO NOTHING;
 UPDATE household_sync_state SET sync_generation=gen_random_uuid() WHERE household_id=h
 RETURNING sync_generation INTO generation;
 RETURN generation;
END $$;
REVOKE ALL ON FUNCTION prune_household_sync(text), reset_household_sync(text) FROM PUBLIC;

CREATE TABLE label_projection_checkpoint (
 household_id text PRIMARY KEY REFERENCES households(id),
 through_item_id text NOT NULL DEFAULT '', as_of_change_id bigint NOT NULL DEFAULT 0,
 completed boolean NOT NULL DEFAULT false
);
-- Existing deployment role is optional in development. No changes to other lanes' grants file.
DO $$ BEGIN
 IF EXISTS(SELECT 1 FROM pg_roles WHERE rolname='acornary_app') THEN
  GRANT SELECT ON sync_object_versions TO acornary_app;
  GRANT SELECT,INSERT,UPDATE ON label_projection_checkpoint TO acornary_app;
  GRANT UPDATE(label_hash,label_updated_at,projected_through_change_id) ON items TO acornary_app;
 END IF;
END $$;
