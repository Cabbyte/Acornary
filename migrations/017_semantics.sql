-- Additive semantic facts. Existing bindings, including availability, remain untouched.
ALTER TABLE items ADD COLUMN voided_at timestamptz;
ALTER TABLE catalog_nodes ADD COLUMN voided_at timestamptz;
CREATE TABLE attribute_references (
 household_id text NOT NULL REFERENCES households(id),
 source_kind text NOT NULL CHECK(source_kind IN ('ITEM','CATALOG_NODE')),
 source_id text NOT NULL, template_id text NOT NULL, path text NOT NULL,
 target_kind text NOT NULL CHECK(target_kind IN ('ACTOR','ITEM','CATALOG_NODE')),
 target_id text NOT NULL,
 PRIMARY KEY(household_id,source_kind,source_id,template_id,path)
);
CREATE INDEX attribute_references_target ON attribute_references(household_id,target_kind,target_id);
CREATE TABLE item_splits (
 household_id text NOT NULL, split_id text NOT NULL, source_item_id text NOT NULL,
 child_item_id text NOT NULL, operation_id text NOT NULL,
 quantity numeric NOT NULL CHECK(quantity > 0), unit text NOT NULL,
 basis text NOT NULL CHECK(basis IN ('COUNT','CONTENT')),
 created_at timestamptz NOT NULL DEFAULT now(),
 PRIMARY KEY(household_id,source_item_id,child_item_id),
 UNIQUE(household_id,child_item_id), CHECK(source_item_id <> child_item_id),
 FOREIGN KEY(household_id,source_item_id) REFERENCES items(household_id,id),
 FOREIGN KEY(household_id,child_item_id) REFERENCES items(household_id,id),
 FOREIGN KEY(household_id,operation_id) REFERENCES operations(household_id,operation_id) DEFERRABLE INITIALLY DEFERRED
);
CREATE INDEX item_splits_operation ON item_splits(household_id,operation_id);

-- Derived reverse indexes are mutable; split provenance is append-only for the runtime.
-- Deployments creating the runtime role later must apply equivalent grants after role setup.
DO $$ BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname='acornary_app') THEN
    GRANT SELECT,INSERT,DELETE ON attribute_references TO acornary_app;
    GRANT SELECT,INSERT ON item_splits TO acornary_app;
  END IF;
END $$;
