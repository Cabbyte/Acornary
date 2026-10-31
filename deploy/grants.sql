-- Run as the migration role after each migration. Runtime cannot run DDL,
-- alter owner mappings, mutate history, or update template definitions.
REVOKE CREATE ON SCHEMA public FROM PUBLIC;
GRANT USAGE ON SCHEMA public TO acornary_app;
GRANT SELECT ON ALL TABLES IN SCHEMA public TO acornary_app;
REVOKE UPDATE,DELETE ON operations FROM acornary_app;
REVOKE DELETE ON catalog_nodes,items,notes FROM acornary_app;
GRANT INSERT ON operations TO acornary_app;
GRANT INSERT,UPDATE ON catalog_nodes,items,notes TO acornary_app;
GRANT INSERT,UPDATE,DELETE ON barcode_index TO acornary_app;
GRANT INSERT ON events TO acornary_app;
GRANT SELECT ON sync_changes,household_sync_state TO acornary_app;
GRANT INSERT (household_id,object_kind,object_id,revision,change_kind,operation_id,after_image)
  ON sync_changes TO acornary_app;
GRANT USAGE ON SEQUENCE sync_changes_change_id_seq TO acornary_app;
GRANT INSERT (household_id,last_committed_change_id),
  UPDATE (last_committed_change_id) ON household_sync_state TO acornary_app;
GRANT INSERT,UPDATE,DELETE ON "user",session,account,verification,jwks,"oauthClient","oauthResource","oauthClientResource","oauthRefreshToken","oauthAccessToken","oauthConsent","oauthClientAssertion","rateLimit" TO acornary_app;

-- Account and household management; histories and template definitions remain immutable.
GRANT INSERT,UPDATE ON households TO acornary_app;
GRANT INSERT ON actors,attribute_templates,household_settings TO acornary_app;
GRANT INSERT,UPDATE,DELETE ON household_members,household_invitations,passkey,auth_enrollments,auth_ceremonies,auth_attempts,auth_oauth_selections TO acornary_app;

GRANT INSERT ON catalog_policy_versions TO acornary_app;
GRANT INSERT,UPDATE ON catalog_proposals TO acornary_app;
GRANT INSERT,UPDATE,DELETE ON catalog_identity_keys TO acornary_app;
