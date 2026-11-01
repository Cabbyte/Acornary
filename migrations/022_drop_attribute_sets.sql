-- Attribute values have been embedded in items/catalog_nodes since 003. The
-- old table is no longer read or written; keep a hard guard so an unexpected
-- legacy row cannot be silently discarded.
DO $$
DECLARE has_rows boolean;
BEGIN
  IF to_regclass('public.attribute_sets') IS NOT NULL THEN
    EXECUTE 'SELECT EXISTS (SELECT 1 FROM attribute_sets)' INTO has_rows;
    IF has_rows THEN
      RAISE EXCEPTION 'attribute_sets still contains rows; run the legacy audit before dropping';
    END IF;
  END IF;
END $$;
DROP TABLE IF EXISTS attribute_sets;
