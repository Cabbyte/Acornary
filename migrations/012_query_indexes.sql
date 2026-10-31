-- Separate from intake's name identity normalization; do not change existing identity keys.
-- NFKC, root-locale Unicode lower (ICU in the deployed PostgreSQL 18 bookworm image),
-- ECMAScript whitespace collapse, trim; independent of the database locale.
CREATE FUNCTION acornary_normalize_search(text) RETURNS text
LANGUAGE sql IMMUTABLE STRICT PARALLEL SAFE AS $$
  SELECT btrim(regexp_replace(lower(normalize($1,NFKC) COLLATE "und-x-icu"),
    U&'[\0009-\000D\0020\00A0\1680\2000-\200A\2028\2029\202F\205F\3000\FEFF]+', ' ', 'g'))
$$;
CREATE EXTENSION IF NOT EXISTS pg_trgm;
CREATE INDEX items_attributes_gin ON items USING gin(attributes jsonb_path_ops);
CREATE INDEX catalog_attributes_gin ON catalog_nodes USING gin(attributes jsonb_path_ops);
CREATE INDEX items_search_name_trgm ON items USING gin(acornary_normalize_search(display_name) gin_trgm_ops);
CREATE INDEX catalog_search_name_trgm ON catalog_nodes USING gin(acornary_normalize_search(name) gin_trgm_ops);
CREATE INDEX items_created_query ON items(household_id,created_at DESC,id DESC);
CREATE INDEX items_updated_query ON items(household_id,updated_at DESC,id DESC);
CREATE INDEX notes_updated_query ON notes(household_id,updated_at DESC,id DESC);
CREATE INDEX events_household_time ON events(household_id,recorded_at DESC,id DESC);
CREATE INDEX catalog_kind_query ON catalog_nodes(household_id,kind,created_at DESC,id DESC);
