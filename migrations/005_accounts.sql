ALTER TABLE "user" ADD COLUMN enabled boolean NOT NULL DEFAULT true;
ALTER TABLE "user" ADD COLUMN auth_version integer NOT NULL DEFAULT 0;
CREATE UNIQUE INDEX user_email_folded ON "user" (lower(email));
CREATE UNIQUE INDEX account_credential_user ON account ("userId") WHERE "providerId"='credential';

CREATE TABLE household_members (
  id text PRIMARY KEY, user_id text NOT NULL REFERENCES "user"(id) ON DELETE CASCADE,
  household_id text NOT NULL REFERENCES households(id), actor_id text NOT NULL,
  joined_at timestamptz NOT NULL DEFAULT now(), UNIQUE(user_id,household_id),
  UNIQUE(household_id,actor_id), FOREIGN KEY(household_id,actor_id) REFERENCES actors(household_id,id)
);
INSERT INTO household_members(id,user_id,household_id,actor_id)
SELECT 'member_' || user_id,user_id,household_id,actor_id FROM auth_owners;
UPDATE "user" u SET enabled=o.enabled FROM auth_owners o WHERE o.user_id=u.id;
CREATE TABLE household_settings (
  household_id text PRIMARY KEY REFERENCES households(id), container_catalog_id text NOT NULL,
  FOREIGN KEY(household_id,container_catalog_id) REFERENCES catalog_nodes(household_id,id)
);
INSERT INTO household_settings SELECT household_id,container_catalog_id FROM installations;
CREATE TABLE household_invitations (
  id text PRIMARY KEY, token_hash text NOT NULL UNIQUE,
  household_id text NOT NULL REFERENCES households(id), created_by text NOT NULL REFERENCES "user"(id),
  expires_at timestamptz NOT NULL, revoked boolean NOT NULL DEFAULT false,
  used_by text REFERENCES "user"(id), created_at timestamptz NOT NULL DEFAULT now()
);
CREATE TABLE passkey (
  id text PRIMARY KEY, name text, "publicKey" text NOT NULL,
  "userId" text NOT NULL REFERENCES "user"(id) ON DELETE CASCADE,
  "credentialID" text NOT NULL UNIQUE, counter double precision NOT NULL CHECK(counter>=0 AND counter<=4294967295 AND counter=trunc(counter)),
  "deviceType" text NOT NULL, "backedUp" boolean NOT NULL,
  transports text, "createdAt" timestamptz, aaguid text
);
CREATE INDEX passkey_user ON passkey("userId");
CREATE TABLE auth_enrollments (
  token_hash text PRIMARY KEY, email text NOT NULL, purpose text NOT NULL CHECK(purpose IN ('register','recover')),
  user_id text NOT NULL, code_hash text, attempts integer NOT NULL DEFAULT 0,
  verified boolean NOT NULL DEFAULT false, expires_at timestamptz NOT NULL
);
CREATE TABLE auth_ceremonies (
  token_hash text PRIMARY KEY, user_id text NOT NULL, challenge text NOT NULL,
  enrollment_hash text REFERENCES auth_enrollments(token_hash) ON DELETE CASCADE,
  session_id text REFERENCES session(id) ON DELETE CASCADE,
  auth_version integer NOT NULL, expires_at timestamptz NOT NULL,
  CHECK(num_nonnulls(enrollment_hash,session_id)=1)
);
CREATE TABLE auth_attempts (key text PRIMARY KEY, count integer NOT NULL, expires_at timestamptz NOT NULL);
CREATE TABLE auth_oauth_selections (
  session_id text REFERENCES session(id) ON DELETE CASCADE, flow_hash text NOT NULL,
  membership_id text NOT NULL REFERENCES household_members(id) ON DELETE CASCADE,
  expires_at timestamptz NOT NULL, PRIMARY KEY(session_id,flow_hash)
);
UPDATE "oauthConsent" t SET "referenceId"='member_' || t."userId" || ':0'
FROM auth_owners o WHERE o.user_id=t."userId" AND t."referenceId" IS NULL;
UPDATE "oauthAccessToken" t SET "referenceId"='member_' || t."userId" || ':0'
FROM auth_owners o WHERE o.user_id=t."userId" AND t."referenceId" IS NULL;
UPDATE "oauthRefreshToken" t SET "referenceId"='member_' || t."userId" || ':0'
FROM auth_owners o WHERE o.user_id=t."userId" AND t."referenceId" IS NULL;

CREATE INDEX auth_enrollments_expiry ON auth_enrollments(expires_at);
CREATE INDEX auth_ceremonies_expiry ON auth_ceremonies(expires_at);
CREATE INDEX auth_attempts_expiry ON auth_attempts(expires_at);
CREATE INDEX auth_oauth_selections_expiry ON auth_oauth_selections(expires_at);
