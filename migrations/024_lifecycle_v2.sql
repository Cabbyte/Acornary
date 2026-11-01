-- The runner owns the transaction. Block concurrent item writes while validating
-- and replacing live bindings; historical events/publications are never changed.
LOCK TABLE items IN SHARE ROW EXCLUSIVE MODE;
DO $$
DECLARE
  binding_count bigint;
  replacement_count bigint;
  changed_count bigint;
  availability_counts jsonb;
BEGIN
  SELECT count(*), jsonb_object_agg(state, n) INTO binding_count, availability_counts
  FROM (
    SELECT coalesce(a->'values'->>'availability', '<unknown>') AS state, count(*) AS n
    FROM items i CROSS JOIN LATERAL jsonb_array_elements(i.attributes) a
    WHERE a->>'template_id'='lifecycle' AND a->'template_version'='1'::jsonb
    GROUP BY 1
  ) counts;
  SELECT count(*) INTO binding_count
  FROM items i CROSS JOIN LATERAL jsonb_array_elements(i.attributes) a
  WHERE a->>'template_id'='lifecycle' AND a->'template_version'='1'::jsonb;
  RAISE NOTICE 'lifecycle v2 preflight: % v1 bindings; availability counts %', binding_count, coalesce(availability_counts, '{}'::jsonb);

  IF EXISTS (
    SELECT 1 FROM items i CROSS JOIN LATERAL jsonb_array_elements(i.attributes) a
    WHERE i.attributes @> '[{"template_id":"lifecycle","template_version":1}]'::jsonb
    GROUP BY i.id, a->>'template_id' HAVING count(*) > 1
  ) THEN RAISE EXCEPTION 'lifecycle v2: duplicate template bindings; repair before migrating'; END IF;
  IF EXISTS (
    SELECT 1 FROM items i CROSS JOIN LATERAL jsonb_array_elements(i.attributes) a
    WHERE a->>'template_id'='lifecycle' AND a->'template_version'='1'::jsonb
      AND (jsonb_typeof(a->'values') IS DISTINCT FROM 'object'
        OR (a->'values'->>'availability' IS NOT NULL AND a->'values'->>'availability'
          NOT IN ('AVAILABLE','IN_USE','LOANED','CLEANING','MAINTENANCE','IN_TRANSIT')))
  ) THEN RAISE EXCEPTION 'lifecycle v2: invalid legacy values; cannot infer replacement'; END IF;

  -- Existing structured facts win, even when empty or from an unknown version.
  WITH legacy AS (
    SELECT i.id, i.attributes, a,
      CASE a->'values'->>'availability'
        WHEN 'IN_USE' THEN 'usage' WHEN 'LOANED' THEN 'custody'
        WHEN 'CLEANING' THEN 'service' WHEN 'MAINTENANCE' THEN 'service'
        WHEN 'IN_TRANSIT' THEN 'transport' END AS replacement
    FROM items i CROSS JOIN LATERAL jsonb_array_elements(i.attributes) a
    WHERE a->>'template_id'='lifecycle' AND a->'template_version'='1'::jsonb
  )
  SELECT count(*) INTO replacement_count FROM legacy l
  WHERE replacement IS NOT NULL AND NOT EXISTS (
    SELECT 1 FROM jsonb_array_elements(l.attributes) b WHERE b->>'template_id'=replacement
  );
  RAISE NOTICE 'lifecycle v2 preflight: % replacement bindings to append', replacement_count;
  IF EXISTS (
    SELECT 1 FROM items i CROSS JOIN LATERAL jsonb_array_elements(i.attributes) a
    WHERE a->>'template_id'='lifecycle' AND a->'template_version'='1'::jsonb
      AND jsonb_array_length(i.attributes) >= 16
      AND a->'values'->>'availability' IN ('IN_USE','LOANED','CLEANING','MAINTENANCE','IN_TRANSIT')
      AND NOT EXISTS (SELECT 1 FROM jsonb_array_elements(i.attributes) b WHERE b->>'template_id' =
        CASE a->'values'->>'availability' WHEN 'IN_USE' THEN 'usage' WHEN 'LOANED' THEN 'custody'
          WHEN 'IN_TRANSIT' THEN 'transport' ELSE 'service' END)
  ) THEN RAISE EXCEPTION 'lifecycle v2: replacement would exceed 16 bindings'; END IF;

  WITH legacy AS (
    SELECT i.id, i.attributes, a,
      CASE a->'values'->>'availability'
        WHEN 'IN_USE' THEN 'usage' WHEN 'LOANED' THEN 'custody'
        WHEN 'CLEANING' THEN 'service' WHEN 'MAINTENANCE' THEN 'service'
        WHEN 'IN_TRANSIT' THEN 'transport' END AS replacement
    FROM items i CROSS JOIN LATERAL jsonb_array_elements(i.attributes) a
    WHERE a->>'template_id'='lifecycle' AND a->'template_version'='1'::jsonb
  ), migrated AS (
    SELECT l.id,
      (SELECT jsonb_agg(CASE WHEN b->>'template_id'='lifecycle'
        THEN jsonb_set(jsonb_set(b, '{values}', (b->'values') - 'availability'), '{template_version}', '2')
        ELSE b END ORDER BY ord) FROM jsonb_array_elements(l.attributes) WITH ORDINALITY AS x(b,ord))
      || CASE WHEN replacement IS NOT NULL AND NOT EXISTS (
        SELECT 1 FROM jsonb_array_elements(l.attributes) b WHERE b->>'template_id'=replacement
      ) THEN jsonb_build_array(jsonb_build_object(
        'template_id',replacement,'template_version',1,
        'values', CASE WHEN replacement='custody' THEN '{"status":"LOANED_OUT"}'::jsonb
          ELSE jsonb_build_object('state',a->'values'->>'availability') END,
        'created_at',a->'created_at','updated_at',a->'updated_at')) ELSE '[]'::jsonb END AS attributes
    FROM legacy l
  )
  UPDATE items i SET attributes=m.attributes FROM migrated m WHERE i.id=m.id;
  GET DIAGNOSTICS changed_count = ROW_COUNT;
  IF changed_count <> binding_count THEN
    RAISE EXCEPTION 'lifecycle v2: expected % item updates, got %', binding_count, changed_count;
  END IF;
  IF EXISTS (SELECT 1 FROM items WHERE attributes @> '[{"template_id":"lifecycle","template_version":1}]'::jsonb) THEN
    RAISE EXCEPTION 'lifecycle v2: incomplete migration';
  END IF;
END $$;
