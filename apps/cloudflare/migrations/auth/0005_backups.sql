-- Frozen authentication rows and a resumable inventory backup fan-out.
CREATE TABLE cf_backup_runs (
 id TEXT PRIMARY KEY, started_at TEXT NOT NULL, completed_at TEXT,
 status TEXT NOT NULL CHECK(status IN ('PENDING','COMPLETE','EXPIRED','PURGED')),
 release_commit TEXT NOT NULL, auth_manifest TEXT, manifest_sha256 TEXT,
 retain_until TEXT NOT NULL, pinned INTEGER NOT NULL DEFAULT 0 CHECK(pinned IN (0,1))
);
CREATE TABLE cf_backup_auth (
 backup_id TEXT NOT NULL REFERENCES cf_backup_runs(id),
 table_name TEXT NOT NULL, row_id TEXT NOT NULL, body TEXT NOT NULL CHECK(json_valid(body)),
 PRIMARY KEY(backup_id,table_name,row_id)
);
CREATE TABLE cf_backup_households (
 backup_id TEXT NOT NULL REFERENCES cf_backup_runs(id), household_id TEXT NOT NULL,
 descriptor TEXT, next_chunk INTEGER NOT NULL DEFAULT 0, after_blob TEXT NOT NULL DEFAULT '',
 completed_at TEXT, manifest_sha256 TEXT,
 PRIMARY KEY(backup_id,household_id)
);
CREATE TABLE cf_backup_blob_refs (
 backup_id TEXT NOT NULL, household_id TEXT NOT NULL, storage_key TEXT NOT NULL,
 byte_length INTEGER NOT NULL, sha256 TEXT NOT NULL,
 PRIMARY KEY(backup_id,household_id,storage_key),
 FOREIGN KEY(backup_id,household_id) REFERENCES cf_backup_households(backup_id,household_id)
);
CREATE INDEX cf_backup_pending ON cf_backup_runs(status,started_at);
CREATE TABLE cf_restore_job (
 singleton INTEGER PRIMARY KEY CHECK(singleton=1), backup_id TEXT NOT NULL,
 manifest_sha256 TEXT NOT NULL, next_auth_file INTEGER NOT NULL DEFAULT 0,
 status TEXT NOT NULL CHECK(status IN ('IMPORTING','AUTH_READY','COMPLETE'))
);
CREATE TABLE cf_restore_files (
 ordinal INTEGER PRIMARY KEY, sha256 TEXT NOT NULL,
 valid_sequence INTEGER NOT NULL CHECK(valid_sequence=1)
);
CREATE TABLE cf_restore_households (
 household_id TEXT PRIMARY KEY, next_chunk INTEGER NOT NULL DEFAULT 0,
 after_blob TEXT NOT NULL DEFAULT '', completed INTEGER NOT NULL DEFAULT 0
);

CREATE TABLE cf_backup_objects (
 sha256 TEXT PRIMARY KEY, state TEXT NOT NULL CHECK(state IN ('LIVE','DELETING')),
 created_at TEXT NOT NULL
);
