-- Source facts remain in ITEM attributes; this table is disposable and rebuildable.
CREATE TABLE date_facts (
  household_id text NOT NULL,
  item_id text NOT NULL,
  source_key text NOT NULL,
  entry_id text NOT NULL,
  kind text NOT NULL CHECK (kind IN ('EXPIRY','WARRANTY_END','SERVICE_DUE','RETURN_BY','RENEWAL','REORDER_BY')),
  due_on date NOT NULL,
  basis text,
  completed_on date,
  source_template text NOT NULL,
  source_version integer NOT NULL CHECK (source_version > 0),
  projected_through_change_id bigint NOT NULL,
  PRIMARY KEY (household_id,item_id,source_key,entry_id),
  FOREIGN KEY (household_id,item_id) REFERENCES items(household_id,id)
);
CREATE INDEX date_facts_actionable ON date_facts(household_id,due_on) WHERE completed_on IS NULL;

-- Do not normalize or rewrite existing timezone strings. Invalid legacy values read as UTC.
CREATE FUNCTION acornary_date_timezone(zone text) RETURNS text
LANGUAGE sql STABLE AS $$
  SELECT coalesce((SELECT name FROM pg_timezone_names WHERE lower(name)=lower(zone)
    AND name NOT LIKE 'posix/%' AND name NOT LIKE 'right/%' LIMIT 1),'UTC')
$$;
CREATE FUNCTION acornary_validate_household_timezone() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_timezone_names WHERE lower(name)=lower(NEW.timezone)
      AND name NOT LIKE 'posix/%' AND name NOT LIKE 'right/%') THEN
    RAISE EXCEPTION 'Invalid household timezone' USING ERRCODE='23514';
  END IF;
  RETURN NEW;
END $$;
CREATE TRIGGER household_timezone_valid BEFORE INSERT OR UPDATE OF timezone ON households
FOR EACH ROW EXECUTE FUNCTION acornary_validate_household_timezone();

-- One source adapter is shared by projection rebuilds and pre-backfill compatibility reads.
CREATE FUNCTION acornary_item_date_sources(attributes jsonb, zone text)
RETURNS TABLE(source_key text, entry_id text, kind text, due_on date, basis text,
  completed_on date, source_template text, source_version integer)
LANGUAGE sql STABLE AS $$
  WITH bindings AS (
    SELECT a->>'template_id' AS template, (a->>'template_version')::integer AS version,
      a->'values' AS v FROM jsonb_array_elements(attributes) a
  )
  SELECT 'lifecycle.expiry','', 'EXPIRY', (v#>>'{expiry,date}')::date,
    'lifecycle.expiry.date',NULL::date,'lifecycle',version
    FROM bindings WHERE template='lifecycle' AND v#>>'{expiry,date}' IS NOT NULL
  UNION ALL
  SELECT 'lifecycle.opening','', 'EXPIRY',
    ((v#>>'{opening,opened_at}')::timestamptz AT TIME ZONE acornary_date_timezone(zone))::date
      + (v#>>'{expiry,after_opening_days}')::integer,
    'lifecycle.opening.opened_at + lifecycle.expiry.after_opening_days',NULL::date,'lifecycle',version
    FROM bindings WHERE template='lifecycle' AND v#>>'{opening,opened_at}' IS NOT NULL
      AND v#>>'{expiry,after_opening_days}' IS NOT NULL
  UNION ALL
  SELECT 'deadline',e->>'id',e->>'kind',(e->>'due_on')::date,e->>'basis',
    CASE WHEN e->>'recurrence_days' IS NULL THEN (e->>'last_completed_on')::date END,
    'deadline',version
    FROM bindings CROSS JOIN LATERAL jsonb_array_elements(coalesce(v->'entries','[]'::jsonb)) e
    WHERE template='deadline'
$$;

INSERT INTO date_facts
SELECT i.household_id,i.id,d.*,coalesce(s.last_committed_change_id,0)
FROM items i JOIN households h ON h.id=i.household_id
LEFT JOIN household_sync_state s ON s.household_id=i.household_id
CROSS JOIN LATERAL acornary_item_date_sources(i.attributes,h.timezone) d;

-- A timezone change can change opening-derived dates, without changing core revisions/events.
CREATE FUNCTION acornary_refresh_timezone_dates() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
  IF NEW.timezone IS DISTINCT FROM OLD.timezone THEN
    PERFORM pg_advisory_xact_lock(hashtextextended(NEW.id,0));
    DELETE FROM date_facts WHERE household_id=NEW.id;
    INSERT INTO date_facts
    SELECT i.household_id,i.id,d.*,coalesce(s.last_committed_change_id,0)
    FROM items i LEFT JOIN household_sync_state s ON s.household_id=i.household_id
    CROSS JOIN LATERAL acornary_item_date_sources(i.attributes,NEW.timezone) d
    WHERE i.household_id=NEW.id;
  END IF;
  RETURN NEW;
END $$;
CREATE TRIGGER household_timezone_dates AFTER UPDATE OF timezone ON households
FOR EACH ROW EXECUTE FUNCTION acornary_refresh_timezone_dates();

-- Runtime projection maintenance needs these privileges; deploy/grants.sql owns other grants.
DO $$ BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname='acornary_app') THEN
    GRANT SELECT,INSERT,DELETE ON date_facts TO acornary_app;
  END IF;
END $$;
