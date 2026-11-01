-- Read-hot date state must not resolve the timezone catalogue for every due row.
-- Household timezone validity is enforced on write by acornary_validate_household_timezone;
-- PostgreSQL's AT TIME ZONE accepts the validated IANA name directly.
CREATE OR REPLACE FUNCTION acornary_date_timezone(zone text) RETURNS text
LANGUAGE sql IMMUTABLE PARALLEL SAFE AS $$
  SELECT coalesce(zone, 'UTC')
$$;
