-- Preserve legacy IDs, bodies and timestamps; item_id remains a compatibility projection.
ALTER TABLE notes ALTER COLUMN item_id DROP NOT NULL;
ALTER TABLE notes ADD COLUMN target_kind text;
ALTER TABLE notes ADD COLUMN target_id text;
ALTER TABLE notes ADD COLUMN updated_by text;
ALTER TABLE notes ADD COLUMN archived_at timestamptz;
ALTER TABLE notes ADD COLUMN sensitivity text NOT NULL DEFAULT 'NORMAL' CHECK(sensitivity IN ('NORMAL','SENSITIVE','SECRET'));
UPDATE notes SET target_kind='ITEM',target_id=item_id,updated_by=created_by;
ALTER TABLE notes ALTER COLUMN target_kind SET NOT NULL;
ALTER TABLE notes ALTER COLUMN target_id SET NOT NULL;
ALTER TABLE notes ALTER COLUMN updated_by SET NOT NULL;
ALTER TABLE notes ADD CONSTRAINT note_target_kind CHECK(target_kind IN ('ITEM','CATALOG_NODE'));
ALTER TABLE notes ADD CONSTRAINT note_item_projection CHECK ((target_kind='ITEM' AND item_id IS NOT NULL AND item_id=target_id) OR (target_kind='CATALOG_NODE' AND item_id IS NULL));
ALTER TABLE notes ADD FOREIGN KEY(household_id,updated_by) REFERENCES actors(household_id,id);
CREATE UNIQUE INDEX notes_household_id ON notes(household_id,id);
CREATE INDEX notes_target ON notes(household_id,target_kind,target_id,id);

CREATE TABLE attachment_blobs (
 id text PRIMARY KEY, household_id text NOT NULL REFERENCES households(id), storage_key text NOT NULL UNIQUE,
 mime_type text NOT NULL CHECK(mime_type IN ('image/jpeg','image/png','image/webp','application/pdf')),
 file_size bigint NOT NULL CHECK(file_size BETWEEN 1 AND 26214400), sha256 text NOT NULL CHECK(sha256 ~ '^[a-f0-9]{64}$'),
 width integer, height integer, thumbnail_key text, exif_stripped boolean NOT NULL DEFAULT false,
 created_at timestamptz NOT NULL DEFAULT now(), detached_at timestamptz,
 UNIQUE(household_id,id)
);
CREATE TABLE upload_sessions (
 id text PRIMARY KEY, household_id text NOT NULL REFERENCES households(id), actor_id text NOT NULL,
 target_kind text NOT NULL CHECK(target_kind IN ('ITEM','CATALOG_NODE','NOTE')), target_id text NOT NULL,
 file_size bigint NOT NULL CHECK(file_size BETWEEN 1 AND 26214400), expected_sha256 text,
 ticket_hash text NOT NULL, expires_at timestamptz NOT NULL, created_at timestamptz NOT NULL DEFAULT now(),
 storage_key text NOT NULL UNIQUE, blob_id text, completed_attachment_id text,
 FOREIGN KEY(household_id,actor_id) REFERENCES actors(household_id,id),
 FOREIGN KEY(household_id,blob_id) REFERENCES attachment_blobs(household_id,id)
);
CREATE INDEX upload_household ON upload_sessions(household_id,expires_at);
CREATE TABLE attachments (
 id text PRIMARY KEY, household_id text NOT NULL REFERENCES households(id), blob_id text NOT NULL,
 target_kind text NOT NULL CHECK(target_kind IN ('ITEM','CATALOG_NODE','NOTE')), target_id text NOT NULL,
 caption text, sort_order integer NOT NULL DEFAULT 0,
 sensitivity text NOT NULL DEFAULT 'NORMAL' CHECK(sensitivity IN ('NORMAL','SENSITIVE','SECRET')),
 created_by text NOT NULL, created_at timestamptz NOT NULL DEFAULT now(), detached_at timestamptz,
 FOREIGN KEY(household_id,blob_id) REFERENCES attachment_blobs(household_id,id),
 FOREIGN KEY(household_id,created_by) REFERENCES actors(household_id,id)
);
CREATE INDEX attachment_target ON attachments(household_id,target_kind,target_id,id) WHERE detached_at IS NULL;
CREATE TABLE sensitive_access_audit (
 id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY, household_id text NOT NULL, actor_id text NOT NULL,
 target_kind text NOT NULL, target_id text NOT NULL, scope text NOT NULL,
 recorded_at timestamptz NOT NULL DEFAULT now(),
 FOREIGN KEY(household_id,actor_id) REFERENCES actors(household_id,id)
);
CREATE TRIGGER immutable_sensitive_audit BEFORE UPDATE OR DELETE ON sensitive_access_audit FOR EACH ROW EXECUTE FUNCTION reject_mutation();

CREATE FUNCTION check_file_target() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
 IF NEW.target_kind='ITEM' THEN
  IF NOT EXISTS(SELECT 1 FROM items WHERE household_id=NEW.household_id AND id=NEW.target_id) THEN RAISE EXCEPTION 'invalid file target' USING ERRCODE='23503'; END IF;
 ELSIF NEW.target_kind='CATALOG_NODE' THEN
  IF NOT EXISTS(SELECT 1 FROM catalog_nodes WHERE household_id=NEW.household_id AND id=NEW.target_id) THEN RAISE EXCEPTION 'invalid file target' USING ERRCODE='23503'; END IF;
 ELSE
  IF NOT EXISTS(SELECT 1 FROM notes WHERE household_id=NEW.household_id AND id=NEW.target_id) THEN RAISE EXCEPTION 'invalid file target' USING ERRCODE='23503'; END IF;
 END IF;
 RETURN NEW;
END $$;
CREATE TRIGGER notes_target_guard BEFORE INSERT OR UPDATE ON notes FOR EACH ROW EXECUTE FUNCTION check_file_target();
CREATE TRIGGER attachments_target_guard BEFORE INSERT OR UPDATE ON attachments FOR EACH ROW EXECUTE FUNCTION check_file_target();
CREATE TRIGGER uploads_target_guard BEFORE INSERT OR UPDATE ON upload_sessions FOR EACH ROW EXECUTE FUNCTION check_file_target();
