-- Account recovery and public registration stay closed. These challenges belong to authenticated
-- passkey enrollment only. All credential mutations consume a guard in one atomic D1 batch.
CREATE TABLE auth_ceremonies (
  token_hash TEXT PRIMARY KEY,
  user_id TEXT NOT NULL REFERENCES user(id),
  challenge TEXT NOT NULL,
  session_id TEXT NOT NULL REFERENCES session(id) ON DELETE CASCADE,
  auth_version INTEGER NOT NULL,
  expires_at TEXT NOT NULL
);
CREATE TABLE auth_oauth_selections (
  session_id TEXT NOT NULL REFERENCES session(id) ON DELETE CASCADE,
  flow_hash TEXT NOT NULL,
  membership_id TEXT NOT NULL REFERENCES membership_directory(id),
  expires_at TEXT NOT NULL,
  PRIMARY KEY(session_id,flow_hash)
);
CREATE TABLE auth_attempts (
  key TEXT PRIMARY KEY,
  window_start INTEGER NOT NULL,
  attempts INTEGER NOT NULL CHECK(attempts>0)
);
CREATE TABLE cf_auth_mutations (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL REFERENCES user(id),
  kind TEXT NOT NULL,
  authorized INTEGER NOT NULL CHECK(authorized=1),
  created_at TEXT NOT NULL
);
CREATE TABLE cf_account_tasks (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL REFERENCES user(id),
  kind TEXT NOT NULL,
  payload TEXT NOT NULL CHECK(json_valid(payload)),
  status TEXT NOT NULL CHECK(status IN ('PENDING','COMPLETE','FAILED')),
  result TEXT CHECK(result IS NULL OR json_valid(result)),
  created_at TEXT NOT NULL
);
CREATE INDEX cf_account_tasks_pending ON cf_account_tasks(status,created_at);
CREATE TABLE cf_invitation_directory (
  token_hash TEXT PRIMARY KEY,
  household_id TEXT NOT NULL REFERENCES household_directory(id),
  expires_at TEXT NOT NULL
);
