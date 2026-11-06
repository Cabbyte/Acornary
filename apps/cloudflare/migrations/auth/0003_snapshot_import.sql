-- Import journal. A completed auth import does not activate households or enable traffic.
CREATE TABLE cf_auth_import (
  singleton INTEGER PRIMARY KEY CHECK(singleton=1),
  manifest_hash TEXT NOT NULL UNIQUE CHECK(length(manifest_hash)=64),
  descriptor TEXT NOT NULL CHECK(json_valid(descriptor)),
  state TEXT NOT NULL CHECK(state IN ('IMPORTING','AUTH_IMPORTED')),
  next_chunk INTEGER NOT NULL DEFAULT 0 CHECK(next_chunk>=0)
);
CREATE TABLE cf_auth_import_chunks (
  chunk_index INTEGER PRIMARY KEY CHECK(chunk_index>=0),
  sha256 TEXT NOT NULL CHECK(length(sha256)=64),
  manifest_hash TEXT NOT NULL REFERENCES cf_auth_import(manifest_hash),
  valid_sequence INTEGER NOT NULL CHECK(valid_sequence=1)
);
