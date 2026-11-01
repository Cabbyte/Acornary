-- Private read projections; deliberately no inventory/sync triggers.
CREATE TABLE frozen_exports (
 id text PRIMARY KEY,
 household_id text NOT NULL REFERENCES households(id),
 actor_id text NOT NULL,
 generation uuid NOT NULL,
 query_kind text NOT NULL CHECK(query_kind IN ('ITEM','CATALOG_NODE')),
 query_hash text NOT NULL,
 disclosure_mode text NOT NULL CHECK(disclosure_mode IN ('REDACTED','SENSITIVE')),
 as_of_change_id bigint NOT NULL CHECK(as_of_change_id >= 0),
 summary jsonb NOT NULL,
 row_count integer NOT NULL CHECK(row_count >= 0),
 cursor_secret text NOT NULL,
 created_at timestamptz NOT NULL DEFAULT now(),
 expires_at timestamptz NOT NULL DEFAULT now() + interval '1 hour',
 UNIQUE(household_id,id),
 FOREIGN KEY(household_id,actor_id) REFERENCES actors(household_id,id),
 CHECK(expires_at <= created_at + interval '1 hour')
);
CREATE INDEX frozen_exports_expiry ON frozen_exports(household_id,expires_at);
CREATE TABLE frozen_export_rows (
 household_id text NOT NULL,
 export_id text NOT NULL,
 ordinal integer NOT NULL CHECK(ordinal >= 0),
 data jsonb NOT NULL,
 PRIMARY KEY(household_id,export_id,ordinal),
 FOREIGN KEY(household_id,export_id) REFERENCES frozen_exports(household_id,id) ON DELETE CASCADE
);
REVOKE ALL ON frozen_exports,frozen_export_rows FROM PUBLIC;
DO $$ BEGIN
 IF EXISTS(SELECT 1 FROM pg_roles WHERE rolname='acornary_app') THEN
  GRANT SELECT,INSERT,DELETE ON frozen_exports,frozen_export_rows TO acornary_app;
 END IF;
END $$;
