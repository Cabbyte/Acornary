-- Additive only: existing catalog, inventory, events and operation fingerprints stay unchanged.
CREATE TABLE catalog_policy_versions (
 household_id text NOT NULL REFERENCES households(id), revision integer NOT NULL CHECK(revision>0),
 rules jsonb NOT NULL CHECK(jsonb_typeof(rules)='array'), actor_id text NOT NULL,
 reason text NOT NULL, created_at timestamptz NOT NULL DEFAULT now(),
 PRIMARY KEY(household_id,revision), FOREIGN KEY(household_id,actor_id) REFERENCES actors(household_id,id)
);
CREATE TRIGGER immutable_catalog_policy BEFORE UPDATE OR DELETE ON catalog_policy_versions FOR EACH ROW EXECUTE FUNCTION reject_mutation();
CREATE TABLE catalog_proposals (
 id uuid PRIMARY KEY, household_id text NOT NULL REFERENCES households(id), actor_id text NOT NULL,
 proposal jsonb NOT NULL, status text NOT NULL DEFAULT 'PENDING' CHECK(status IN ('PENDING','APPROVED')),
 challenge_hash text, challenge_scope text, challenge_expires_at timestamptz,
 approved_at timestamptz, consumed_by text, result jsonb,
 created_at timestamptz NOT NULL DEFAULT now(),
 FOREIGN KEY(household_id,actor_id) REFERENCES actors(household_id,id)
);
CREATE INDEX catalog_proposal_owner ON catalog_proposals(household_id,actor_id,created_at);
CREATE TABLE catalog_identity_keys (
 household_id text NOT NULL, identity_key text NOT NULL, catalog_node_id text NOT NULL,
 policy_revision integer NOT NULL, PRIMARY KEY(household_id,identity_key),
 FOREIGN KEY(household_id,catalog_node_id) REFERENCES catalog_nodes(household_id,id)
);
CREATE INDEX catalog_identity_node ON catalog_identity_keys(household_id,catalog_node_id);
CREATE FUNCTION acornary_normalize_name(text) RETURNS text LANGUAGE sql IMMUTABLE STRICT PARALLEL SAFE AS $$ SELECT lower(btrim(normalize($1,NFKC), E' \t\r\n')) $$;
CREATE INDEX catalog_folded_name ON catalog_nodes(household_id,acornary_normalize_name(name));
CREATE INDEX intake_receipt_operation ON operations(household_id,(result->>'operation_id'));
