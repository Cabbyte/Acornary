-- Run as the migration role after each migration. Runtime cannot run DDL,
-- alter owner mappings, mutate history, or update template definitions.
REVOKE CREATE ON SCHEMA public FROM PUBLIC;
GRANT USAGE ON SCHEMA public TO acornary_app;
GRANT SELECT ON ALL TABLES IN SCHEMA public TO acornary_app;
GRANT INSERT,UPDATE,DELETE ON catalog_nodes,items,notes,barcode_index,operations TO acornary_app;
GRANT INSERT ON events TO acornary_app;
GRANT INSERT,UPDATE,DELETE ON "user",session,account,verification,jwks,"oauthClient","oauthResource","oauthClientResource","oauthRefreshToken","oauthAccessToken","oauthConsent","oauthClientAssertion","rateLimit" TO acornary_app;

-- Account and household management; histories and template definitions remain immutable.
GRANT INSERT,UPDATE ON households TO acornary_app;
GRANT INSERT ON actors,attribute_templates,household_settings TO acornary_app;
GRANT INSERT,UPDATE,DELETE ON household_members,household_invitations,passkey,auth_enrollments,auth_ceremonies,auth_attempts,auth_oauth_selections TO acornary_app;
