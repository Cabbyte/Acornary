-- Keep the fallback-to-UTC behavior for legacy invalid timezone rows without
-- scanning the filesystem-backed pg_timezone_names view on every due row.
CREATE TABLE IF NOT EXISTS acornary_timezone_names(name text PRIMARY KEY);
INSERT INTO acornary_timezone_names(name)
SELECT name FROM pg_timezone_names
WHERE name NOT LIKE 'posix/%' AND name NOT LIKE 'right/%'
ON CONFLICT DO NOTHING;
CREATE INDEX IF NOT EXISTS acornary_timezone_names_lower ON acornary_timezone_names (lower(name));
CREATE OR REPLACE FUNCTION acornary_date_timezone(zone text) RETURNS text
LANGUAGE sql STABLE AS $$
  SELECT coalesce((SELECT name FROM acornary_timezone_names WHERE lower(name)=lower(zone) LIMIT 1), 'UTC')
$$;
