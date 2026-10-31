CREATE TABLE household_sync_state (
 household_id text PRIMARY KEY REFERENCES households(id),
 sync_generation uuid NOT NULL DEFAULT gen_random_uuid(),
 last_committed_change_id bigint NOT NULL DEFAULT 0,
 pruned_through_change_id bigint NOT NULL DEFAULT 0
);
INSERT INTO household_sync_state(household_id) SELECT id FROM households;

CREATE TABLE sync_changes (
 change_id bigserial PRIMARY KEY,
 household_id text NOT NULL REFERENCES households(id),
 object_kind text NOT NULL CHECK(object_kind IN ('ITEM','CATALOG_NODE')),
 object_id text NOT NULL,
 revision integer NOT NULL,
 change_kind text NOT NULL CHECK(change_kind IN ('UPSERT','TOMBSTONE')),
 operation_id text,
 payload_version integer NOT NULL DEFAULT 1,
 after_image jsonb,
 created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX sync_changes_household_change ON sync_changes(household_id,change_id);
