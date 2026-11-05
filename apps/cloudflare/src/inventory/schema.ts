// SQLite schema version 1. Household facts only; principals and credentials live in D1.
export const householdSchemaVersion = 1;
export const householdSchema = `
CREATE VIEW cf_clock AS SELECT strftime('%Y-%m-%dT%H:%M:%f000Z','now') AS now;
CREATE TABLE households (
  "id" TEXT NOT NULL,
  "name" TEXT NOT NULL,
  "timezone" TEXT NOT NULL,
  "created_at" TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%f000Z','now')),
  "updated_at" TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%f000Z','now')),
  CHECK ((length(id)=46 AND substr(id,1,10)='household_' AND substr(id,11) NOT GLOB '*[^0-9a-f-]*')),
  PRIMARY KEY (id)
);
CREATE TABLE actors (
  "id" TEXT NOT NULL,
  "household_id" TEXT NOT NULL,
  "name" TEXT NOT NULL,
  FOREIGN KEY (household_id) REFERENCES households(id),
  CHECK ((length(household_id)=46 AND substr(household_id,1,10)='household_' AND substr(household_id,11) NOT GLOB '*[^0-9a-f-]*')),
  UNIQUE (household_id, id),
  CHECK ((length(id)=42 AND substr(id,1,6)='actor_' AND substr(id,7) NOT GLOB '*[^0-9a-f-]*')),
  PRIMARY KEY (id)
);
CREATE TABLE catalog_nodes (
  "id" TEXT NOT NULL,
  "household_id" TEXT NOT NULL,
  "parent_id" TEXT,
  "kind" TEXT NOT NULL,
  "name" TEXT NOT NULL,
  "revision" INTEGER NOT NULL DEFAULT 1,
  "created_at" TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%f000Z','now')),
  "updated_at" TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%f000Z','now')),
  "attributes" TEXT NOT NULL DEFAULT '[]' CHECK("attributes" IS NULL OR json_valid("attributes")),
  "profile" TEXT,
  "capabilities" TEXT CHECK("capabilities" IS NULL OR json_valid("capabilities")),
  "one_off" INTEGER NOT NULL DEFAULT 0 CHECK("one_off" IN (0,1)),
  "record_state" TEXT NOT NULL DEFAULT 'VALID',
  "voided_at" TEXT,
  CHECK ((json_type(attributes) = 'array')),
  CHECK ((parent_id IS NOT id)),
  FOREIGN KEY (household_id) REFERENCES households(id),
  CHECK ((length(household_id)=46 AND substr(household_id,1,10)='household_' AND substr(household_id,11) NOT GLOB '*[^0-9a-f-]*')),
  UNIQUE (household_id, id),
  FOREIGN KEY (household_id, parent_id) REFERENCES catalog_nodes(household_id, id),
  CHECK ((length(id)=49 AND substr(id,1,13)='catalog_node_' AND substr(id,14) NOT GLOB '*[^0-9a-f-]*')),
  CHECK ((kind IN ('GROUP', 'SKU'))),
  CHECK ((length(trim(name)) > 0)),
  CHECK ((length(parent_id)=49 AND substr(parent_id,1,13)='catalog_node_' AND substr(parent_id,14) NOT GLOB '*[^0-9a-f-]*')),
  PRIMARY KEY (id),
  CHECK ((profile IN ('CONSUMABLE', 'DURABLE', 'WEARABLE', 'SPACE', 'MISC'))),
  CHECK ((record_state IN ('VALID', 'VOID'))),
  CHECK ((revision > 0))
);
CREATE TABLE items (
  "id" TEXT NOT NULL,
  "household_id" TEXT NOT NULL,
  "catalog_node_id" TEXT NOT NULL,
  "parent_id" TEXT,
  "display_name" TEXT,
  "revision" INTEGER NOT NULL DEFAULT 1,
  "created_at" TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%f000Z','now')),
  "updated_at" TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%f000Z','now')),
  "attributes" TEXT NOT NULL DEFAULT '[]' CHECK("attributes" IS NULL OR json_valid("attributes")),
  "record_state" TEXT NOT NULL DEFAULT 'VALID',
  "label_hash" TEXT,
  "label_updated_at" TEXT,
  "projected_through_change_id" TEXT NOT NULL DEFAULT 0 CHECK(length("projected_through_change_id") BETWEEN 1 AND 19 AND "projected_through_change_id" NOT GLOB '*[^0-9]*' AND ("projected_through_change_id"='0' OR substr("projected_through_change_id",1,1)<>'0')),
  "voided_at" TEXT,
  CHECK ((json_type(attributes) = 'array')),
  CHECK ((length(catalog_node_id)=49 AND substr(catalog_node_id,1,13)='catalog_node_' AND substr(catalog_node_id,14) NOT GLOB '*[^0-9a-f-]*')),
  CHECK ((parent_id IS NOT id)),
  FOREIGN KEY (household_id, catalog_node_id) REFERENCES catalog_nodes(household_id, id),
  FOREIGN KEY (household_id) REFERENCES households(id),
  CHECK ((length(household_id)=46 AND substr(household_id,1,10)='household_' AND substr(household_id,11) NOT GLOB '*[^0-9a-f-]*')),
  UNIQUE (household_id, id),
  FOREIGN KEY (household_id, parent_id) REFERENCES items(household_id, id),
  CHECK ((length(id)=41 AND substr(id,1,5)='item_' AND substr(id,6) NOT GLOB '*[^0-9a-f-]*')),
  CHECK ((length(parent_id)=41 AND substr(parent_id,1,5)='item_' AND substr(parent_id,6) NOT GLOB '*[^0-9a-f-]*')),
  PRIMARY KEY (id),
  CHECK ((record_state IN ('VALID', 'VOID'))),
  CHECK ((revision > 0))
);
CREATE TABLE attribute_templates (
  "household_id" TEXT NOT NULL,
  "id" TEXT NOT NULL,
  "version" INTEGER NOT NULL,
  "target_kind" TEXT NOT NULL,
  "definition" TEXT NOT NULL CHECK("definition" IS NULL OR json_valid("definition")),
  "created_at" TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%f000Z','now')),
  FOREIGN KEY (household_id) REFERENCES households(id),
  CHECK ((length(household_id)=46 AND substr(household_id,1,10)='household_' AND substr(household_id,11) NOT GLOB '*[^0-9a-f-]*')),
  PRIMARY KEY (household_id, id, version),
  CHECK ((target_kind IN ('ITEM', 'CATALOG_NODE'))),
  CHECK ((version > 0))
);
CREATE TABLE notes (
  "id" TEXT NOT NULL,
  "household_id" TEXT NOT NULL,
  "title" TEXT,
  "body" TEXT NOT NULL,
  "body_format" TEXT NOT NULL DEFAULT 'Markdown',
  "created_by" TEXT NOT NULL,
  "created_at" TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%f000Z','now')),
  "updated_at" TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%f000Z','now')),
  "target_kind" TEXT NOT NULL,
  "target_id" TEXT NOT NULL,
  "updated_by" TEXT NOT NULL,
  "archived_at" TEXT,
  "sensitivity" TEXT NOT NULL DEFAULT 'NORMAL',
  CHECK ((target_kind IN ('ITEM', 'CATALOG_NODE'))),
  CHECK ((body_format = 'Markdown')),
  CHECK ((length(created_by)=42 AND substr(created_by,1,6)='actor_' AND substr(created_by,7) NOT GLOB '*[^0-9a-f-]*')),
  FOREIGN KEY (household_id, created_by) REFERENCES actors(household_id, id),
  CHECK ((length(household_id)=46 AND substr(household_id,1,10)='household_' AND substr(household_id,11) NOT GLOB '*[^0-9a-f-]*')),
  FOREIGN KEY (household_id, updated_by) REFERENCES actors(household_id, id),
  CHECK ((length(id)=41 AND substr(id,1,5)='note_' AND substr(id,6) NOT GLOB '*[^0-9a-f-]*')),
  PRIMARY KEY (id),
  CHECK ((sensitivity IN ('NORMAL', 'SENSITIVE', 'SECRET')))
);
CREATE TABLE events (
  "id" TEXT NOT NULL,
  "household_id" TEXT NOT NULL,
  "target_kind" TEXT NOT NULL,
  "target_id" TEXT NOT NULL,
  "operation_id" TEXT NOT NULL,
  "event_type" TEXT NOT NULL,
  "reason" TEXT,
  "before_revision" INTEGER NOT NULL,
  "after_revision" INTEGER NOT NULL,
  "changes" TEXT NOT NULL CHECK("changes" IS NULL OR json_valid("changes")),
  "actor_id" TEXT NOT NULL,
  "source" TEXT NOT NULL,
  "occurred_at" TEXT NOT NULL,
  "recorded_at" TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%f000Z','now')),
  CHECK ((length(actor_id)=42 AND substr(actor_id,1,6)='actor_' AND substr(actor_id,7) NOT GLOB '*[^0-9a-f-]*')),
  CHECK ((event_type IN ('CREATE', 'UPDATE', 'MOVE', 'OPEN', 'CONSUME_ITEMS', 'CONSUME_CONTENT', 'CORRECT', 'ATTRIBUTE_BIND', 'ATTRIBUTE_UPDATE', 'ATTRIBUTE_REMOVE', 'ATTRIBUTE_UPGRADE', 'EDIT', 'VOID', 'DISPOSE', 'SPLIT', 'NOTE_CREATE', 'NOTE_UPDATE', 'NOTE_ARCHIVE', 'ATTACHMENT_ATTACH', 'ATTACHMENT_DETACH', 'ADD_DEADLINE', 'UPDATE_DEADLINE', 'REMOVE_DEADLINE', 'COMPLETE_DEADLINE'))),
  FOREIGN KEY (household_id, actor_id) REFERENCES actors(household_id, id),
  FOREIGN KEY (household_id) REFERENCES households(id),
  CHECK ((length(household_id)=46 AND substr(household_id,1,10)='household_' AND substr(household_id,11) NOT GLOB '*[^0-9a-f-]*')),
  CHECK ((length(id)=42 AND substr(id,1,6)='event_' AND substr(id,7) NOT GLOB '*[^0-9a-f-]*')),
  FOREIGN KEY (household_id, operation_id) REFERENCES operations(household_id, operation_id) DEFERRABLE INITIALLY DEFERRED,
  CHECK ((length(operation_id)=46 AND substr(operation_id,1,10)='operation_' AND substr(operation_id,11) NOT GLOB '*[^0-9a-f-]*')),
  PRIMARY KEY (id),
  CHECK ((source IN ('WEB', 'MCP', 'MCP_UI', 'ANDROID', 'TERMINAL', 'IMPORT', 'SYSTEM', 'TEST', 'BENCHMARK', 'MIGRATION_TEST'))),
  CHECK(substr(target_id,1,length(target_kind)+1)=lower(target_kind)||'_' AND length(target_id)=length(target_kind)+37),
  CHECK ((target_kind IN ('ITEM', 'CATALOG_NODE')))
);
CREATE TABLE operations (
  "household_id" TEXT NOT NULL,
  "actor_id" TEXT NOT NULL,
  "idempotency_key" TEXT NOT NULL,
  "fingerprint" TEXT NOT NULL,
  "result" TEXT CHECK("result" IS NULL OR json_valid("result")),
  "created_at" TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%f000Z','now')),
  "operation_id" TEXT NOT NULL,
  result_payload TEXT REFERENCES cf_payloads(id),
  CHECK ((result IS NULL) <> (result_payload IS NULL)),
  CHECK (result IS NULL OR json_extract(result,'$.operation_id')=operation_id),
  CHECK ((length(actor_id)=42 AND substr(actor_id,1,6)='actor_' AND substr(actor_id,7) NOT GLOB '*[^0-9a-f-]*')),
  FOREIGN KEY (household_id, actor_id) REFERENCES actors(household_id, id),
  CHECK ((length(household_id)=46 AND substr(household_id,1,10)='household_' AND substr(household_id,11) NOT GLOB '*[^0-9a-f-]*')),
  UNIQUE (household_id, operation_id),
  PRIMARY KEY (household_id, actor_id, idempotency_key)
);
CREATE TABLE barcode_index (
  "household_id" TEXT NOT NULL,
  "barcode" TEXT NOT NULL,
  "catalog_node_id" TEXT NOT NULL,
  CHECK ((length(catalog_node_id)=49 AND substr(catalog_node_id,1,13)='catalog_node_' AND substr(catalog_node_id,14) NOT GLOB '*[^0-9a-f-]*')),
  FOREIGN KEY (household_id, catalog_node_id) REFERENCES catalog_nodes(household_id, id),
  CHECK ((length(household_id)=46 AND substr(household_id,1,10)='household_' AND substr(household_id,11) NOT GLOB '*[^0-9a-f-]*')),
  PRIMARY KEY (household_id, barcode)
);
CREATE TABLE installations (
  "slot" TEXT NOT NULL,
  "household_id" TEXT NOT NULL,
  "actor_id" TEXT NOT NULL,
  "container_catalog_id" TEXT NOT NULL,
  CHECK ((length(actor_id)=42 AND substr(actor_id,1,6)='actor_' AND substr(actor_id,7) NOT GLOB '*[^0-9a-f-]*')),
  CHECK ((length(container_catalog_id)=49 AND substr(container_catalog_id,1,13)='catalog_node_' AND substr(container_catalog_id,14) NOT GLOB '*[^0-9a-f-]*')),
  FOREIGN KEY (household_id, actor_id) REFERENCES actors(household_id, id),
  FOREIGN KEY (household_id, container_catalog_id) REFERENCES catalog_nodes(household_id, id),
  FOREIGN KEY (household_id) REFERENCES households(id),
  CHECK ((length(household_id)=46 AND substr(household_id,1,10)='household_' AND substr(household_id,11) NOT GLOB '*[^0-9a-f-]*')),
  PRIMARY KEY (slot)
);
CREATE TABLE household_settings (
  "household_id" TEXT NOT NULL,
  "container_catalog_id" TEXT NOT NULL,
  FOREIGN KEY (household_id, container_catalog_id) REFERENCES catalog_nodes(household_id, id),
  FOREIGN KEY (household_id) REFERENCES households(id),
  PRIMARY KEY (household_id)
);
CREATE TABLE catalog_policy_versions (
  "household_id" TEXT NOT NULL,
  "revision" INTEGER NOT NULL,
  "rules" TEXT NOT NULL CHECK("rules" IS NULL OR json_valid("rules")),
  "actor_id" TEXT NOT NULL,
  "reason" TEXT NOT NULL,
  "created_at" TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%f000Z','now')),
  FOREIGN KEY (household_id, actor_id) REFERENCES actors(household_id, id),
  FOREIGN KEY (household_id) REFERENCES households(id),
  PRIMARY KEY (household_id, revision),
  CHECK ((revision > 0)),
  CHECK ((json_type(rules) = 'array'))
);
CREATE TABLE catalog_proposals (
  "id" TEXT NOT NULL,
  "household_id" TEXT NOT NULL,
  "actor_id" TEXT NOT NULL,
  "proposal" TEXT NOT NULL CHECK("proposal" IS NULL OR json_valid("proposal")),
  "status" TEXT NOT NULL DEFAULT 'PENDING',
  "challenge_hash" TEXT,
  "challenge_scope" TEXT,
  "challenge_expires_at" TEXT,
  "approved_at" TEXT,
  "consumed_by" TEXT,
  "result" TEXT CHECK("result" IS NULL OR json_valid("result")),
  "created_at" TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%f000Z','now')),
  FOREIGN KEY (household_id, actor_id) REFERENCES actors(household_id, id),
  FOREIGN KEY (household_id) REFERENCES households(id),
  PRIMARY KEY (id),
  CHECK ((status IN ('PENDING', 'APPROVED')))
);
CREATE TABLE catalog_identity_keys (
  "household_id" TEXT NOT NULL,
  "identity_key" TEXT NOT NULL,
  "catalog_node_id" TEXT NOT NULL,
  "policy_revision" INTEGER NOT NULL,
  FOREIGN KEY (household_id, catalog_node_id) REFERENCES catalog_nodes(household_id, id),
  PRIMARY KEY (household_id, identity_key)
);
CREATE TABLE date_facts (
  "household_id" TEXT NOT NULL,
  "item_id" TEXT NOT NULL,
  "source_key" TEXT NOT NULL,
  "entry_id" TEXT NOT NULL,
  "kind" TEXT NOT NULL,
  "due_on" TEXT NOT NULL,
  "basis" TEXT,
  "completed_on" TEXT,
  "source_template" TEXT NOT NULL,
  "source_version" INTEGER NOT NULL,
  "projected_through_change_id" TEXT NOT NULL CHECK(length("projected_through_change_id") BETWEEN 1 AND 19 AND "projected_through_change_id" NOT GLOB '*[^0-9]*' AND ("projected_through_change_id"='0' OR substr("projected_through_change_id",1,1)<>'0')),
  FOREIGN KEY (household_id, item_id) REFERENCES items(household_id, id),
  CHECK ((kind IN ('EXPIRY', 'WARRANTY_END', 'SERVICE_DUE', 'RETURN_BY', 'RENEWAL', 'REORDER_BY'))),
  PRIMARY KEY (household_id, item_id, source_key, entry_id),
  CHECK ((source_version > 0))
);
CREATE TABLE household_sync_state (
  "household_id" TEXT NOT NULL,
  "sync_generation" TEXT NOT NULL,
  "last_committed_change_id" TEXT NOT NULL DEFAULT 0 CHECK(length("last_committed_change_id") BETWEEN 1 AND 19 AND "last_committed_change_id" NOT GLOB '*[^0-9]*' AND ("last_committed_change_id"='0' OR substr("last_committed_change_id",1,1)<>'0')),
  "pruned_through_change_id" TEXT NOT NULL DEFAULT 0 CHECK(length("pruned_through_change_id") BETWEEN 1 AND 19 AND "pruned_through_change_id" NOT GLOB '*[^0-9]*' AND ("pruned_through_change_id"='0' OR substr("pruned_through_change_id",1,1)<>'0')),
  FOREIGN KEY (household_id) REFERENCES households(id),
  PRIMARY KEY (household_id)
);
CREATE TABLE sync_changes (
  "change_id" TEXT NOT NULL CHECK(length("change_id") BETWEEN 1 AND 19 AND "change_id" NOT GLOB '*[^0-9]*' AND ("change_id"='0' OR substr("change_id",1,1)<>'0')),
  "household_id" TEXT NOT NULL,
  "object_kind" TEXT NOT NULL,
  "object_id" TEXT NOT NULL,
  "revision" INTEGER NOT NULL,
  "change_kind" TEXT NOT NULL,
  "operation_id" TEXT,
  "payload_version" INTEGER NOT NULL DEFAULT 1,
  "after_image" TEXT CHECK("after_image" IS NULL OR json_valid("after_image")),
  "created_at" TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%f000Z','now')),
  CHECK ((after_image IS NULL)),
  CHECK ((change_kind IN ('UPSERT', 'TOMBSTONE'))),
  FOREIGN KEY (household_id) REFERENCES households(id),
  CHECK ((object_kind IN ('ITEM', 'CATALOG_NODE', 'NOTE', 'ATTACHMENT'))),
  PRIMARY KEY (change_id)
);
CREATE TABLE sync_object_versions (
  "household_id" TEXT NOT NULL,
  "object_kind" TEXT NOT NULL,
  "object_id" TEXT NOT NULL,
  "last_change_id" TEXT NOT NULL CHECK(length("last_change_id") BETWEEN 1 AND 19 AND "last_change_id" NOT GLOB '*[^0-9]*' AND ("last_change_id"='0' OR substr("last_change_id",1,1)<>'0')),
  "change_kind" TEXT NOT NULL,
  FOREIGN KEY (household_id) REFERENCES households(id),
  PRIMARY KEY (household_id, object_kind, object_id)
);
CREATE TABLE label_projection_checkpoint (
  "household_id" TEXT NOT NULL,
  "through_item_id" TEXT NOT NULL DEFAULT '',
  "as_of_change_id" TEXT NOT NULL DEFAULT 0 CHECK(length("as_of_change_id") BETWEEN 1 AND 19 AND "as_of_change_id" NOT GLOB '*[^0-9]*' AND ("as_of_change_id"='0' OR substr("as_of_change_id",1,1)<>'0')),
  "completed" INTEGER NOT NULL DEFAULT 0 CHECK("completed" IN (0,1)),
  FOREIGN KEY (household_id) REFERENCES households(id),
  PRIMARY KEY (household_id)
);
CREATE TABLE attachments (
  "id" TEXT NOT NULL,
  "household_id" TEXT NOT NULL,
  "blob_id" TEXT NOT NULL,
  "target_kind" TEXT NOT NULL,
  "target_id" TEXT NOT NULL,
  "caption" TEXT,
  "sort_order" INTEGER NOT NULL DEFAULT 0,
  "sensitivity" TEXT NOT NULL DEFAULT 'NORMAL',
  "created_by" TEXT NOT NULL,
  "created_at" TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%f000Z','now')),
  "detached_at" TEXT,
  FOREIGN KEY (household_id, blob_id) REFERENCES attachment_blobs(household_id, id),
  FOREIGN KEY (household_id, created_by) REFERENCES actors(household_id, id),
  FOREIGN KEY (household_id) REFERENCES households(id),
  PRIMARY KEY (id),
  CHECK ((sensitivity IN ('NORMAL', 'SENSITIVE', 'SECRET'))),
  CHECK ((target_kind IN ('ITEM', 'CATALOG_NODE', 'NOTE')))
);
CREATE TABLE attachment_blobs (
  "id" TEXT NOT NULL,
  "household_id" TEXT NOT NULL,
  "storage_key" TEXT NOT NULL,
  "mime_type" TEXT NOT NULL,
  "file_size" INTEGER NOT NULL,
  "sha256" TEXT NOT NULL,
  "width" INTEGER,
  "height" INTEGER,
  "thumbnail_key" TEXT,
  "exif_stripped" INTEGER NOT NULL DEFAULT 0 CHECK("exif_stripped" IN (0,1)),
  "created_at" TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%f000Z','now')),
  "detached_at" TEXT,
  CHECK (((file_size >= 1) AND (file_size <= 26214400))),
  FOREIGN KEY (household_id) REFERENCES households(id),
  UNIQUE (household_id, id),
  CHECK ((mime_type IN ('image/jpeg', 'image/png', 'image/webp', 'application/pdf'))),
  PRIMARY KEY (id),
  CHECK(length(sha256)=64 AND sha256 NOT GLOB '*[^a-f0-9]*'),
  UNIQUE (storage_key)
);
CREATE TABLE sensitive_access_audit (
  "id" INTEGER PRIMARY KEY AUTOINCREMENT,
  "household_id" TEXT NOT NULL,
  "actor_id" TEXT NOT NULL,
  "target_kind" TEXT NOT NULL,
  "target_id" TEXT NOT NULL,
  "scope" TEXT NOT NULL,
  "recorded_at" TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%f000Z','now')),
  FOREIGN KEY (household_id, actor_id) REFERENCES actors(household_id, id)
);
CREATE TABLE item_splits (
  "household_id" TEXT NOT NULL,
  "split_id" TEXT NOT NULL,
  "source_item_id" TEXT NOT NULL,
  "child_item_id" TEXT NOT NULL,
  "operation_id" TEXT NOT NULL,
  "quantity" TEXT NOT NULL,
  "unit" TEXT NOT NULL,
  "basis" TEXT NOT NULL,
  "created_at" TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%f000Z','now')),
  CHECK ((basis IN ('COUNT', 'CONTENT'))),
  CHECK ((source_item_id <> child_item_id)),
  FOREIGN KEY (household_id, child_item_id) REFERENCES items(household_id, id),
  UNIQUE (household_id, child_item_id),
  FOREIGN KEY (household_id, operation_id) REFERENCES operations(household_id, operation_id) DEFERRABLE INITIALLY DEFERRED,
  FOREIGN KEY (household_id, source_item_id) REFERENCES items(household_id, id),
  PRIMARY KEY (household_id, source_item_id, child_item_id),
  CHECK(length(quantity)>0 AND quantity NOT GLOB '*[^0-9.]*' AND replace(replace(quantity,'0',''),'.','')<>'')
);
CREATE TABLE attribute_references (
  "household_id" TEXT NOT NULL,
  "source_kind" TEXT NOT NULL,
  "source_id" TEXT NOT NULL,
  "template_id" TEXT NOT NULL,
  "path" TEXT NOT NULL,
  "target_kind" TEXT NOT NULL,
  "target_id" TEXT NOT NULL,
  FOREIGN KEY (household_id) REFERENCES households(id),
  PRIMARY KEY (household_id, source_kind, source_id, template_id, path),
  CHECK ((source_kind IN ('ITEM', 'CATALOG_NODE'))),
  CHECK ((target_kind IN ('ACTOR', 'ITEM', 'CATALOG_NODE')))
);
CREATE TABLE household_members (
  "id" TEXT NOT NULL,
  "user_id" TEXT NOT NULL,
  "household_id" TEXT NOT NULL,
  "actor_id" TEXT NOT NULL,
  "joined_at" TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%f000Z','now')),
  FOREIGN KEY (household_id, actor_id) REFERENCES actors(household_id, id),
  UNIQUE (household_id, actor_id),
  FOREIGN KEY (household_id) REFERENCES households(id),
  PRIMARY KEY (id),
  UNIQUE (user_id, household_id)
);
CREATE TABLE household_invitations (
  "id" TEXT NOT NULL,
  "token_hash" TEXT NOT NULL,
  "household_id" TEXT NOT NULL,
  "created_by" TEXT NOT NULL,
  "expires_at" TEXT NOT NULL,
  "revoked" INTEGER NOT NULL DEFAULT 0 CHECK("revoked" IN (0,1)),
  "used_by" TEXT,
  "created_at" TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%f000Z','now')),
  FOREIGN KEY (household_id) REFERENCES households(id),
  PRIMARY KEY (id),
  UNIQUE (token_hash)
);
CREATE TABLE upload_sessions (
  "id" TEXT NOT NULL,
  "household_id" TEXT NOT NULL,
  "actor_id" TEXT NOT NULL,
  "target_kind" TEXT NOT NULL,
  "target_id" TEXT NOT NULL,
  "file_size" INTEGER NOT NULL,
  "expected_sha256" TEXT,
  "ticket_hash" TEXT NOT NULL,
  "expires_at" TEXT NOT NULL,
  "created_at" TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%f000Z','now')),
  "storage_key" TEXT NOT NULL,
  "blob_id" TEXT,
  "completed_attachment_id" TEXT,
  CHECK (((file_size >= 1) AND (file_size <= 26214400))),
  FOREIGN KEY (household_id, actor_id) REFERENCES actors(household_id, id),
  FOREIGN KEY (household_id, blob_id) REFERENCES attachment_blobs(household_id, id),
  FOREIGN KEY (household_id) REFERENCES households(id),
  PRIMARY KEY (id),
  UNIQUE (storage_key),
  CHECK ((target_kind IN ('ITEM', 'CATALOG_NODE', 'NOTE')))
);
CREATE TABLE frozen_exports (
  "id" TEXT NOT NULL,
  "household_id" TEXT NOT NULL,
  "actor_id" TEXT NOT NULL,
  "generation" TEXT NOT NULL,
  "query_kind" TEXT NOT NULL,
  "query_hash" TEXT NOT NULL,
  "disclosure_mode" TEXT NOT NULL,
  "as_of_change_id" TEXT NOT NULL CHECK(length("as_of_change_id") BETWEEN 1 AND 19 AND "as_of_change_id" NOT GLOB '*[^0-9]*' AND ("as_of_change_id"='0' OR substr("as_of_change_id",1,1)<>'0')),
  "summary" TEXT NOT NULL CHECK("summary" IS NULL OR json_valid("summary")),
  "row_count" INTEGER NOT NULL,
  "cursor_secret" TEXT NOT NULL,
  "created_at" TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%f000Z','now')),
  "expires_at" TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%f000Z','now','+1 hour')),
  CHECK ((as_of_change_id >= 0)),
  CHECK (expires_at <= strftime('%Y-%m-%dT%H:%M:%f000Z',created_at,'+1 hour')),
  CHECK ((disclosure_mode IN ('REDACTED', 'SENSITIVE'))),
  FOREIGN KEY (household_id, actor_id) REFERENCES actors(household_id, id),
  FOREIGN KEY (household_id) REFERENCES households(id),
  UNIQUE (household_id, id),
  PRIMARY KEY (id),
  CHECK ((query_kind IN ('ITEM', 'CATALOG_NODE'))),
  CHECK ((row_count >= 0))
);
CREATE TABLE frozen_export_rows (
  "household_id" TEXT NOT NULL,
  "export_id" TEXT NOT NULL,
  "ordinal" INTEGER NOT NULL,
  "data" TEXT NOT NULL CHECK("data" IS NULL OR json_valid("data")),
  FOREIGN KEY (household_id, export_id) REFERENCES frozen_exports(household_id, id) ON DELETE CASCADE,
  CHECK ((ordinal >= 0)),
  PRIMARY KEY (household_id, export_id, ordinal)
);
CREATE INDEX actors_household ON actors(household_id);
CREATE INDEX catalog_nodes_household ON catalog_nodes(household_id);
CREATE INDEX items_household ON items(household_id);
CREATE INDEX attribute_templates_household ON attribute_templates(household_id);
CREATE INDEX notes_household ON notes(household_id);
CREATE INDEX events_household ON events(household_id);
CREATE INDEX operations_household ON operations(household_id);
CREATE INDEX barcode_index_household ON barcode_index(household_id);
CREATE INDEX installations_household ON installations(household_id);
CREATE INDEX household_settings_household ON household_settings(household_id);
CREATE INDEX catalog_policy_versions_household ON catalog_policy_versions(household_id);
CREATE INDEX catalog_proposals_household ON catalog_proposals(household_id);
CREATE INDEX catalog_identity_keys_household ON catalog_identity_keys(household_id);
CREATE INDEX date_facts_household ON date_facts(household_id);
CREATE INDEX household_sync_state_household ON household_sync_state(household_id);
CREATE INDEX sync_changes_household ON sync_changes(household_id);
CREATE INDEX sync_object_versions_household ON sync_object_versions(household_id);
CREATE INDEX label_projection_checkpoint_household ON label_projection_checkpoint(household_id);
CREATE INDEX attachments_household ON attachments(household_id);
CREATE INDEX attachment_blobs_household ON attachment_blobs(household_id);
CREATE INDEX sensitive_access_audit_household ON sensitive_access_audit(household_id);
CREATE INDEX item_splits_household ON item_splits(household_id);
CREATE INDEX attribute_references_household ON attribute_references(household_id);
CREATE INDEX household_members_household ON household_members(household_id);
CREATE INDEX household_invitations_household ON household_invitations(household_id);
CREATE INDEX upload_sessions_household ON upload_sessions(household_id);
CREATE INDEX frozen_exports_household ON frozen_exports(household_id);
CREATE INDEX frozen_export_rows_household ON frozen_export_rows(household_id);
CREATE INDEX native_catalog_nodes_58 ON catalog_nodes(household_id,parent_id);
CREATE INDEX native_items_59 ON items(household_id,parent_id);
CREATE INDEX native_items_60 ON items(household_id,catalog_node_id);
CREATE INDEX native_events_61 ON events(household_id,target_kind,target_id,recorded_at,id);
CREATE INDEX native_notes_62 ON notes(household_id,target_kind,target_id);
CREATE INDEX native_attachments_63 ON attachments(household_id,target_kind,target_id);
CREATE INDEX native_sync_changes_64 ON sync_changes(household_id,length(change_id),change_id);
CREATE INDEX native_date_facts_65 ON date_facts(household_id,due_on);
CREATE INDEX native_item_splits_66 ON item_splits(household_id,source_item_id);
CREATE INDEX native_item_splits_67 ON item_splits(household_id,child_item_id);
CREATE TABLE cf_backup_sets(id TEXT PRIMARY KEY,descriptor TEXT NOT NULL,mode TEXT NOT NULL CHECK(mode IN ('SNAPSHOT','RESTORE','VALIDATED','RESTORED')),next_chunk INTEGER NOT NULL,root TEXT NOT NULL);
CREATE TABLE cf_backup_blobs(backup_id TEXT NOT NULL,storage_key TEXT NOT NULL,file_size INTEGER,sha256 TEXT,PRIMARY KEY(backup_id,storage_key));
CREATE TABLE cf_backup_chunks(backup_id TEXT NOT NULL,ordinal INTEGER NOT NULL,body TEXT NOT NULL,digest TEXT NOT NULL,PRIMARY KEY(backup_id,ordinal));
CREATE TABLE cf_upload_attempts(lease_id TEXT PRIMARY KEY,upload_id TEXT NOT NULL REFERENCES upload_sessions(id),source_sha256 TEXT NOT NULL,storage_key TEXT NOT NULL UNIQUE,lease_expires_at TEXT NOT NULL,state TEXT NOT NULL CHECK(state IN ('WRITING','CONFIRMED','CLEANED')));CREATE INDEX cf_upload_attempts_upload ON cf_upload_attempts(upload_id,state);
CREATE TABLE cf_store_state (singleton INTEGER PRIMARY KEY CHECK(singleton=1), household_id TEXT NOT NULL, schema_version INTEGER NOT NULL, status TEXT NOT NULL CHECK(status IN ('IMPORTING','ACTIVE','FROZEN')), manifest_hash TEXT, next_chunk INTEGER NOT NULL DEFAULT 0);
CREATE TABLE cf_outbox (id TEXT PRIMARY KEY, kind TEXT NOT NULL, payload TEXT NOT NULL CHECK(json_valid(payload)), created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%f000Z','now')), delivered_at TEXT);
CREATE TABLE cf_directory_clock(singleton INTEGER PRIMARY KEY CHECK(singleton=1),revision TEXT NOT NULL);
INSERT INTO cf_directory_clock VALUES(1,'0');
CREATE TABLE cf_account_receipts(id TEXT PRIMARY KEY,user_id TEXT NOT NULL,fingerprint TEXT NOT NULL,response TEXT NOT NULL CHECK(json_valid(response)));
CREATE TABLE cf_import_manifest(singleton INTEGER PRIMARY KEY CHECK(singleton=1),fingerprint TEXT NOT NULL,descriptor TEXT NOT NULL,status TEXT NOT NULL CHECK(status IN ('IMPORTING','VALIDATED','ACTIVE')));
CREATE TABLE cf_import_parts(row_number INTEGER NOT NULL,table_name TEXT NOT NULL,part_count INTEGER NOT NULL,ordinal INTEGER PRIMARY KEY,data TEXT NOT NULL);
CREATE TABLE cf_import_blob_checks(storage_key TEXT PRIMARY KEY,byte_length INTEGER NOT NULL,sha256 TEXT NOT NULL);
CREATE TABLE cf_import_chunks (ordinal INTEGER PRIMARY KEY, digest TEXT NOT NULL);
CREATE TRIGGER immutable_events_update BEFORE UPDATE ON events BEGIN SELECT RAISE(ABORT,'STATE_CONFLICT: Append-only relation'); END;
CREATE TRIGGER immutable_events_delete BEFORE DELETE ON events BEGIN SELECT RAISE(ABORT,'STATE_CONFLICT: Append-only relation'); END;
CREATE TRIGGER immutable_operations_update BEFORE UPDATE ON operations BEGIN SELECT RAISE(ABORT,'STATE_CONFLICT: Append-only relation'); END;
CREATE TRIGGER immutable_operations_delete BEFORE DELETE ON operations BEGIN SELECT RAISE(ABORT,'STATE_CONFLICT: Append-only relation'); END;
CREATE TRIGGER immutable_attribute_templates_update BEFORE UPDATE ON attribute_templates BEGIN SELECT RAISE(ABORT,'STATE_CONFLICT: Append-only relation'); END;
CREATE TRIGGER immutable_attribute_templates_delete BEFORE DELETE ON attribute_templates BEGIN SELECT RAISE(ABORT,'STATE_CONFLICT: Append-only relation'); END;
CREATE TRIGGER immutable_catalog_policy_versions_update BEFORE UPDATE ON catalog_policy_versions BEGIN SELECT RAISE(ABORT,'STATE_CONFLICT: Append-only relation'); END;
CREATE TRIGGER immutable_catalog_policy_versions_delete BEFORE DELETE ON catalog_policy_versions BEGIN SELECT RAISE(ABORT,'STATE_CONFLICT: Append-only relation'); END;
CREATE TRIGGER immutable_item_splits_update BEFORE UPDATE ON item_splits BEGIN SELECT RAISE(ABORT,'STATE_CONFLICT: Append-only relation'); END;
CREATE TRIGGER immutable_item_splits_delete BEFORE DELETE ON item_splits BEGIN SELECT RAISE(ABORT,'STATE_CONFLICT: Append-only relation'); END;
CREATE TRIGGER immutable_sensitive_access_audit_update BEFORE UPDATE ON sensitive_access_audit BEGIN SELECT RAISE(ABORT,'STATE_CONFLICT: Append-only relation'); END;
CREATE TRIGGER immutable_sensitive_access_audit_delete BEFORE DELETE ON sensitive_access_audit BEGIN SELECT RAISE(ABORT,'STATE_CONFLICT: Append-only relation'); END;
CREATE TRIGGER events_insert_size BEFORE INSERT ON events WHEN length(CAST(NEW.changes AS BLOB))>1048576 BEGIN SELECT RAISE(ABORT,'ATTRIBUTE_VALIDATION_FAILED: Event exceeds 1 MiB'); END;
CREATE TRIGGER events_target_insert BEFORE INSERT ON events WHEN NOT ((NEW.target_kind='ITEM' AND EXISTS(SELECT 1 FROM items WHERE household_id=NEW.household_id AND id=NEW.target_id)) OR (NEW.target_kind='CATALOG_NODE' AND EXISTS(SELECT 1 FROM catalog_nodes WHERE household_id=NEW.household_id AND id=NEW.target_id))) BEGIN SELECT RAISE(ABORT,'REFERENCE_INVALID: Invalid target'); END;
CREATE TRIGGER events_target_update BEFORE UPDATE ON events WHEN NOT ((NEW.target_kind='ITEM' AND EXISTS(SELECT 1 FROM items WHERE household_id=NEW.household_id AND id=NEW.target_id)) OR (NEW.target_kind='CATALOG_NODE' AND EXISTS(SELECT 1 FROM catalog_nodes WHERE household_id=NEW.household_id AND id=NEW.target_id))) BEGIN SELECT RAISE(ABORT,'REFERENCE_INVALID: Invalid target'); END;
CREATE TRIGGER notes_target_insert BEFORE INSERT ON notes WHEN NOT ((NEW.target_kind='ITEM' AND EXISTS(SELECT 1 FROM items WHERE household_id=NEW.household_id AND id=NEW.target_id)) OR (NEW.target_kind='CATALOG_NODE' AND EXISTS(SELECT 1 FROM catalog_nodes WHERE household_id=NEW.household_id AND id=NEW.target_id))) BEGIN SELECT RAISE(ABORT,'REFERENCE_INVALID: Invalid target'); END;
CREATE TRIGGER notes_target_update BEFORE UPDATE ON notes WHEN NOT ((NEW.target_kind='ITEM' AND EXISTS(SELECT 1 FROM items WHERE household_id=NEW.household_id AND id=NEW.target_id)) OR (NEW.target_kind='CATALOG_NODE' AND EXISTS(SELECT 1 FROM catalog_nodes WHERE household_id=NEW.household_id AND id=NEW.target_id))) BEGIN SELECT RAISE(ABORT,'REFERENCE_INVALID: Invalid target'); END;
CREATE TRIGGER attachments_target_insert BEFORE INSERT ON attachments WHEN NOT ((NEW.target_kind='ITEM' AND EXISTS(SELECT 1 FROM items WHERE household_id=NEW.household_id AND id=NEW.target_id)) OR (NEW.target_kind='CATALOG_NODE' AND EXISTS(SELECT 1 FROM catalog_nodes WHERE household_id=NEW.household_id AND id=NEW.target_id)) OR (NEW.target_kind='NOTE' AND EXISTS(SELECT 1 FROM notes WHERE household_id=NEW.household_id AND id=NEW.target_id))) BEGIN SELECT RAISE(ABORT,'REFERENCE_INVALID: Invalid target'); END;
CREATE TRIGGER attachments_target_update BEFORE UPDATE ON attachments WHEN NOT ((NEW.target_kind='ITEM' AND EXISTS(SELECT 1 FROM items WHERE household_id=NEW.household_id AND id=NEW.target_id)) OR (NEW.target_kind='CATALOG_NODE' AND EXISTS(SELECT 1 FROM catalog_nodes WHERE household_id=NEW.household_id AND id=NEW.target_id)) OR (NEW.target_kind='NOTE' AND EXISTS(SELECT 1 FROM notes WHERE household_id=NEW.household_id AND id=NEW.target_id))) BEGIN SELECT RAISE(ABORT,'REFERENCE_INVALID: Invalid target'); END;
CREATE TRIGGER upload_sessions_target_insert BEFORE INSERT ON upload_sessions WHEN NOT ((NEW.target_kind='ITEM' AND EXISTS(SELECT 1 FROM items WHERE household_id=NEW.household_id AND id=NEW.target_id)) OR (NEW.target_kind='CATALOG_NODE' AND EXISTS(SELECT 1 FROM catalog_nodes WHERE household_id=NEW.household_id AND id=NEW.target_id)) OR (NEW.target_kind='NOTE' AND EXISTS(SELECT 1 FROM notes WHERE household_id=NEW.household_id AND id=NEW.target_id))) BEGIN SELECT RAISE(ABORT,'REFERENCE_INVALID: Invalid target'); END;
CREATE TRIGGER upload_sessions_target_update BEFORE UPDATE ON upload_sessions WHEN NOT ((NEW.target_kind='ITEM' AND EXISTS(SELECT 1 FROM items WHERE household_id=NEW.household_id AND id=NEW.target_id)) OR (NEW.target_kind='CATALOG_NODE' AND EXISTS(SELECT 1 FROM catalog_nodes WHERE household_id=NEW.household_id AND id=NEW.target_id)) OR (NEW.target_kind='NOTE' AND EXISTS(SELECT 1 FROM notes WHERE household_id=NEW.household_id AND id=NEW.target_id))) BEGIN SELECT RAISE(ABORT,'REFERENCE_INVALID: Invalid target'); END;
CREATE TRIGGER item_splits_consistent BEFORE INSERT ON item_splits WHEN EXISTS(SELECT 1 FROM item_splits s WHERE s.household_id=NEW.household_id AND ((s.split_id=NEW.split_id AND (s.source_item_id<>NEW.source_item_id OR s.operation_id<>NEW.operation_id OR s.basis<>NEW.basis OR s.unit<>NEW.unit)) OR (s.source_item_id=NEW.source_item_id AND s.split_id<>NEW.split_id))) BEGIN SELECT RAISE(ABORT,'STATE_CONFLICT: Inconsistent split provenance'); END;
CREATE UNIQUE INDEX notes_household_identity ON notes(household_id,id);
`;
export const columnTypes: Record<string, Record<string, string>> = {
  households: {
    id: 'text',
    name: 'text',
    timezone: 'text',
    created_at: 'timestamptz',
    updated_at: 'timestamptz',
  },
  actors: {
    id: 'text',
    household_id: 'text',
    name: 'text',
  },
  catalog_nodes: {
    id: 'text',
    household_id: 'text',
    parent_id: 'text',
    kind: 'text',
    name: 'text',
    revision: 'int4',
    created_at: 'timestamptz',
    updated_at: 'timestamptz',
    attributes: 'jsonb',
    profile: 'text',
    capabilities: '_text',
    one_off: 'bool',
    record_state: 'text',
    voided_at: 'timestamptz',
  },
  items: {
    id: 'text',
    household_id: 'text',
    catalog_node_id: 'text',
    parent_id: 'text',
    display_name: 'text',
    revision: 'int4',
    created_at: 'timestamptz',
    updated_at: 'timestamptz',
    attributes: 'jsonb',
    record_state: 'text',
    label_hash: 'text',
    label_updated_at: 'timestamptz',
    projected_through_change_id: 'int8',
    voided_at: 'timestamptz',
  },
  attribute_templates: {
    household_id: 'text',
    id: 'text',
    version: 'int4',
    target_kind: 'text',
    definition: 'jsonb',
    created_at: 'timestamptz',
  },
  notes: {
    id: 'text',
    household_id: 'text',
    title: 'text',
    body: 'text',
    body_format: 'text',
    created_by: 'text',
    created_at: 'timestamptz',
    updated_at: 'timestamptz',
    target_kind: 'text',
    target_id: 'text',
    updated_by: 'text',
    archived_at: 'timestamptz',
    sensitivity: 'text',
  },
  events: {
    id: 'text',
    household_id: 'text',
    target_kind: 'text',
    target_id: 'text',
    operation_id: 'text',
    event_type: 'text',
    reason: 'text',
    before_revision: 'int4',
    after_revision: 'int4',
    changes: 'jsonb',
    actor_id: 'text',
    source: 'text',
    occurred_at: 'timestamptz',
    recorded_at: 'timestamptz',
  },
  operations: {
    household_id: 'text',
    actor_id: 'text',
    idempotency_key: 'text',
    fingerprint: 'text',
    result: 'jsonb',
    created_at: 'timestamptz',
    operation_id: 'text',
  },
  barcode_index: {
    household_id: 'text',
    barcode: 'text',
    catalog_node_id: 'text',
  },
  installations: {
    slot: 'text',
    household_id: 'text',
    actor_id: 'text',
    container_catalog_id: 'text',
  },
  household_settings: {
    household_id: 'text',
    container_catalog_id: 'text',
  },
  catalog_policy_versions: {
    household_id: 'text',
    revision: 'int4',
    rules: 'jsonb',
    actor_id: 'text',
    reason: 'text',
    created_at: 'timestamptz',
  },
  catalog_proposals: {
    id: 'uuid',
    household_id: 'text',
    actor_id: 'text',
    proposal: 'jsonb',
    status: 'text',
    challenge_hash: 'text',
    challenge_scope: 'text',
    challenge_expires_at: 'timestamptz',
    approved_at: 'timestamptz',
    consumed_by: 'text',
    result: 'jsonb',
    created_at: 'timestamptz',
  },
  catalog_identity_keys: {
    household_id: 'text',
    identity_key: 'text',
    catalog_node_id: 'text',
    policy_revision: 'int4',
  },
  date_facts: {
    household_id: 'text',
    item_id: 'text',
    source_key: 'text',
    entry_id: 'text',
    kind: 'text',
    due_on: 'date',
    basis: 'text',
    completed_on: 'date',
    source_template: 'text',
    source_version: 'int4',
    projected_through_change_id: 'int8',
  },
  household_sync_state: {
    household_id: 'text',
    sync_generation: 'uuid',
    last_committed_change_id: 'int8',
    pruned_through_change_id: 'int8',
  },
  sync_changes: {
    change_id: 'int8',
    household_id: 'text',
    object_kind: 'text',
    object_id: 'text',
    revision: 'int4',
    change_kind: 'text',
    operation_id: 'text',
    payload_version: 'int4',
    after_image: 'jsonb',
    created_at: 'timestamptz',
  },
  sync_object_versions: {
    household_id: 'text',
    object_kind: 'text',
    object_id: 'text',
    last_change_id: 'int8',
    change_kind: 'text',
  },
  label_projection_checkpoint: {
    household_id: 'text',
    through_item_id: 'text',
    as_of_change_id: 'int8',
    completed: 'bool',
  },
  attachments: {
    id: 'text',
    household_id: 'text',
    blob_id: 'text',
    target_kind: 'text',
    target_id: 'text',
    caption: 'text',
    sort_order: 'int4',
    sensitivity: 'text',
    created_by: 'text',
    created_at: 'timestamptz',
    detached_at: 'timestamptz',
  },
  attachment_blobs: {
    id: 'text',
    household_id: 'text',
    storage_key: 'text',
    mime_type: 'text',
    file_size: 'int8',
    sha256: 'text',
    width: 'int4',
    height: 'int4',
    thumbnail_key: 'text',
    exif_stripped: 'bool',
    created_at: 'timestamptz',
    detached_at: 'timestamptz',
  },
  sensitive_access_audit: {
    id: 'int8',
    household_id: 'text',
    actor_id: 'text',
    target_kind: 'text',
    target_id: 'text',
    scope: 'text',
    recorded_at: 'timestamptz',
  },
  item_splits: {
    household_id: 'text',
    split_id: 'text',
    source_item_id: 'text',
    child_item_id: 'text',
    operation_id: 'text',
    quantity: 'numeric',
    unit: 'text',
    basis: 'text',
    created_at: 'timestamptz',
  },
  attribute_references: {
    household_id: 'text',
    source_kind: 'text',
    source_id: 'text',
    template_id: 'text',
    path: 'text',
    target_kind: 'text',
    target_id: 'text',
  },
  household_members: {
    id: 'text',
    user_id: 'text',
    household_id: 'text',
    actor_id: 'text',
    joined_at: 'timestamptz',
  },
  household_invitations: {
    id: 'text',
    token_hash: 'text',
    household_id: 'text',
    created_by: 'text',
    expires_at: 'timestamptz',
    revoked: 'bool',
    used_by: 'text',
    created_at: 'timestamptz',
  },
  upload_sessions: {
    id: 'text',
    household_id: 'text',
    actor_id: 'text',
    target_kind: 'text',
    target_id: 'text',
    file_size: 'int8',
    expected_sha256: 'text',
    ticket_hash: 'text',
    expires_at: 'timestamptz',
    created_at: 'timestamptz',
    storage_key: 'text',
    blob_id: 'text',
    completed_attachment_id: 'text',
  },
  frozen_exports: {
    id: 'text',
    household_id: 'text',
    actor_id: 'text',
    generation: 'uuid',
    query_kind: 'text',
    query_hash: 'text',
    disclosure_mode: 'text',
    as_of_change_id: 'int8',
    summary: 'jsonb',
    row_count: 'int4',
    cursor_secret: 'text',
    created_at: 'timestamptz',
    expires_at: 'timestamptz',
  },
  frozen_export_rows: {
    household_id: 'text',
    export_id: 'text',
    ordinal: 'int4',
    data: 'jsonb',
  },
};
