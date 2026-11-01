-- Compatibility bridge for pre-Batch-7 writers that insert notes by item_id only.
-- New application writes set target_kind/target_id/updated_by explicitly; this keeps
-- direct imports, fixtures and old clients working without weakening the target guard.
CREATE FUNCTION notes_legacy_target() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF NEW.target_kind IS NULL AND NEW.item_id IS NOT NULL THEN
    NEW.target_kind := 'ITEM';
    NEW.target_id := NEW.item_id;
  END IF;
  IF NEW.updated_by IS NULL THEN
    NEW.updated_by := NEW.created_by;
  END IF;
  RETURN NEW;
END $$;
CREATE TRIGGER notes_legacy_target BEFORE INSERT ON notes
FOR EACH ROW EXECUTE FUNCTION notes_legacy_target();
