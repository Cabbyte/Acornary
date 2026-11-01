-- Notes have had target_kind/target_id since 016 and the item_id projection is
-- no longer written or read. Keep a guard; then remove the bridge and column.
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM notes WHERE target_kind IS NULL OR target_id IS NULL) THEN
    RAISE EXCEPTION 'notes target backfill is incomplete';
  END IF;
END $$;
DROP TRIGGER IF EXISTS notes_legacy_target ON notes;
DROP FUNCTION IF EXISTS notes_legacy_target();
ALTER TABLE notes
  DROP CONSTRAINT IF EXISTS note_item_projection,
  DROP CONSTRAINT IF EXISTS notes_item_id_format,
  DROP CONSTRAINT IF EXISTS notes_household_id_item_id_fkey,
  DROP COLUMN IF EXISTS item_id;
DROP INDEX IF EXISTS note_item;
