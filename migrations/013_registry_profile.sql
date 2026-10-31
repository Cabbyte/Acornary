-- Expand only: do not rewrite bindings, revisions, events or published definitions.
ALTER TABLE catalog_nodes
  ADD COLUMN profile text CHECK (profile IN ('CONSUMABLE','DURABLE','WEARABLE','SPACE','MISC')),
  ADD COLUMN capabilities text[],
  ADD COLUMN one_off boolean NOT NULL DEFAULT false,
  ADD COLUMN record_state text NOT NULL DEFAULT 'VALID' CHECK (record_state IN ('VALID','VOID'));
ALTER TABLE items
  ADD COLUMN record_state text NOT NULL DEFAULT 'VALID' CHECK (record_state IN ('VALID','VOID'));
-- attribute_templates already has an immutable (household_id,id,version) publication log.
-- New publications store separate schema_hash/ui_hash inside definition; old rows stay intact.
