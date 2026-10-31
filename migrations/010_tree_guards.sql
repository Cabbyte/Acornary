-- The migrator supplies the transaction. Writers use READ COMMITTED and one
-- household per transaction, matching the service's advisory-lock protocol.
-- VOLATILE queries take fresh snapshots after a competing writer releases it.
CREATE FUNCTION guard_items_tree() RETURNS trigger LANGUAGE plpgsql VOLATILE AS $$
BEGIN
  PERFORM pg_advisory_xact_lock(hashtextextended(NEW.household_id, 0));

  IF TG_OP = 'UPDATE' THEN
    IF NEW.id IS DISTINCT FROM OLD.id OR NEW.household_id IS DISTINCT FROM OLD.household_id THEN
      RAISE EXCEPTION USING ERRCODE = '23514', MESSAGE = 'TREE_IMMUTABLE_IDENTITY: item id and household_id cannot change';
    END IF;
    -- Contents and other bindings share attributes; skip tree reads when the
    -- actual container capability and all structural fields are unchanged.
    IF NEW.parent_id IS NOT DISTINCT FROM OLD.parent_id
       AND NEW.catalog_node_id IS NOT DISTINCT FROM OLD.catalog_node_id
       AND (NEW.attributes @> '[{"template_id":"container","values":{"can_contain":true}}]'::jsonb)
           IS NOT DISTINCT FROM
           (OLD.attributes @> '[{"template_id":"container","values":{"can_contain":true}}]'::jsonb) THEN
      RETURN NEW;
    END IF;
  END IF;

  IF NOT EXISTS (SELECT 1 FROM catalog_nodes
                 WHERE household_id = NEW.household_id AND id = NEW.catalog_node_id AND kind = 'SKU') THEN
    RAISE EXCEPTION USING ERRCODE = '23514', MESSAGE = 'TREE_ITEM_SKU: item must reference a SKU in the same household';
  END IF;
  IF NEW.parent_id = NEW.id THEN
    RAISE EXCEPTION USING ERRCODE = '23514', MESSAGE = 'TREE_ITEM_SELF_PARENT: item cannot parent itself';
  END IF;
  IF NEW.parent_id IS NOT NULL THEN
    IF NOT EXISTS (SELECT 1 FROM items WHERE household_id = NEW.household_id AND id = NEW.parent_id
                   AND attributes @> '[{"template_id":"container","values":{"can_contain":true}}]'::jsonb) THEN
      RAISE EXCEPTION USING ERRCODE = '23514', MESSAGE = 'TREE_ITEM_PARENT: parent must be a capable item container in the same household';
    END IF;
    IF EXISTS (
      WITH RECURSIVE ancestors AS (
        SELECT id, parent_id, ARRAY[id] AS visited, false AS cycle
        FROM items WHERE household_id = NEW.household_id AND id = NEW.parent_id
        UNION ALL
        SELECT n.id, n.parent_id, a.visited || n.id, n.id = ANY(a.visited)
        FROM items n JOIN ancestors a ON n.id = a.parent_id
        WHERE n.household_id = NEW.household_id AND NOT a.cycle
      )
      SELECT 1 FROM ancestors WHERE id = NEW.id OR cycle
    ) THEN
      RAISE EXCEPTION USING ERRCODE = '23514', MESSAGE = 'TREE_ITEM_CYCLE: item parent chain contains a cycle';
    END IF;
  END IF;
  IF (NEW.attributes @> '[{"template_id":"container","values":{"can_contain":true}}]'::jsonb) IS NOT TRUE
     AND EXISTS (SELECT 1 FROM items WHERE household_id = NEW.household_id AND parent_id = NEW.id) THEN
    RAISE EXCEPTION USING ERRCODE = '23514', MESSAGE = 'TREE_CONTAINER_IN_USE: item with children must retain container capability';
  END IF;
  RETURN NEW;
END $$;

CREATE TRIGGER items_tree_guard
BEFORE INSERT OR UPDATE OF parent_id, catalog_node_id, attributes, household_id, id ON items
FOR EACH ROW EXECUTE FUNCTION guard_items_tree();

CREATE FUNCTION guard_catalog_tree() RETURNS trigger LANGUAGE plpgsql VOLATILE AS $$
BEGIN
  PERFORM pg_advisory_xact_lock(hashtextextended(NEW.household_id, 0));

  IF TG_OP = 'UPDATE' THEN
    IF NEW.id IS DISTINCT FROM OLD.id OR NEW.household_id IS DISTINCT FROM OLD.household_id THEN
      RAISE EXCEPTION USING ERRCODE = '23514', MESSAGE = 'TREE_IMMUTABLE_IDENTITY: catalog id and household_id cannot change';
    END IF;
  END IF;
  IF NEW.parent_id = NEW.id THEN
    RAISE EXCEPTION USING ERRCODE = '23514', MESSAGE = 'TREE_CATALOG_SELF_PARENT: catalog node cannot parent itself';
  END IF;
  IF NEW.parent_id IS NOT NULL THEN
    IF NOT EXISTS (SELECT 1 FROM catalog_nodes
                   WHERE household_id = NEW.household_id AND id = NEW.parent_id AND kind = 'GROUP') THEN
      RAISE EXCEPTION USING ERRCODE = '23514', MESSAGE = 'TREE_CATALOG_PARENT: parent must be a GROUP in the same household';
    END IF;
    IF EXISTS (
      WITH RECURSIVE ancestors AS (
        SELECT id, parent_id, ARRAY[id] AS visited, false AS cycle
        FROM catalog_nodes WHERE household_id = NEW.household_id AND id = NEW.parent_id
        UNION ALL
        SELECT n.id, n.parent_id, a.visited || n.id, n.id = ANY(a.visited)
        FROM catalog_nodes n JOIN ancestors a ON n.id = a.parent_id
        WHERE n.household_id = NEW.household_id AND NOT a.cycle
      )
      SELECT 1 FROM ancestors WHERE id = NEW.id OR cycle
    ) THEN
      RAISE EXCEPTION USING ERRCODE = '23514', MESSAGE = 'TREE_CATALOG_CYCLE: catalog parent chain contains a cycle';
    END IF;
  END IF;
  IF NEW.kind = 'SKU'
     AND EXISTS (SELECT 1 FROM catalog_nodes WHERE household_id = NEW.household_id AND parent_id = NEW.id) THEN
    RAISE EXCEPTION USING ERRCODE = '23514', MESSAGE = 'TREE_SKU_CHILDREN: SKU cannot have catalog children';
  END IF;
  IF NEW.kind IS DISTINCT FROM 'SKU'
     AND EXISTS (SELECT 1 FROM items WHERE household_id = NEW.household_id AND catalog_node_id = NEW.id) THEN
    RAISE EXCEPTION USING ERRCODE = '23514', MESSAGE = 'TREE_SKU_IN_USE: catalog node referenced by items must remain a SKU';
  END IF;
  RETURN NEW;
END $$;

CREATE TRIGGER catalog_tree_guard
BEFORE INSERT OR UPDATE OF parent_id, kind, household_id, id ON catalog_nodes
FOR EACH ROW EXECUTE FUNCTION guard_catalog_tree();
