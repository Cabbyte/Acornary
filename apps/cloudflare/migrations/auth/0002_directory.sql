-- Lookup projections only. Household DO membership remains authoritative.
CREATE UNIQUE INDEX user_email_folded ON user(lower(email));
CREATE UNIQUE INDEX credential_user ON account(userId) WHERE providerId='credential';
CREATE UNIQUE INDEX passkey_credential_unique ON passkey(credentialID);
CREATE TABLE household_directory (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  state TEXT NOT NULL CHECK(state IN ('PENDING','ACTIVE','DISABLED')),
  revision INTEGER NOT NULL CHECK(revision>0)
);
CREATE TABLE membership_directory (
  id TEXT PRIMARY KEY,
  household_id TEXT NOT NULL REFERENCES household_directory(id),
  user_id TEXT NOT NULL REFERENCES user(id),
  deleted INTEGER NOT NULL CHECK(deleted IN (0,1)),
  revision INTEGER NOT NULL CHECK(revision>0)
);
CREATE INDEX membership_directory_user ON membership_directory(user_id,deleted);
