# Batch 4 — registry / profile / capabilities

Implemented on `codex/wave2-registry`, based on `codex/data-model-v2`. Only the owned files and listed service paths are changed. No dependencies or templates were added.

## Storage and registry

`013_registry_profile.sql` adds the frozen nullable `catalog_nodes.profile` / `capabilities`, non-null `one_off DEFAULT false`, and `catalog_nodes.record_state` / `items.record_state DEFAULT 'VALID'`. Profile and record-state checks use the frozen values. Migration 013 does not update IDs, bindings, events, revisions, or existing template publications.

`packages/contracts/src/registry.ts` holds the existing seven template IDs and eight published versions, the unchanged validators, generated write-ID enum, explicit upgrade edges, UI field metadata, capability vocabulary and the single `resolveCapabilities` implementation. Versions are positive integers and binding limits are 16, independent of the registry size. The existing product 1→2 edge is the only published upgrade; the service no longer special-cases it. Frozen `from_version` / `to_version` requests require the actual source version and complete target values. The old `template_version` upgrade request remains supported without renormalizing its fingerprint.

`apps/server/src/registry.ts` uses the existing immutable `attribute_templates` publication table. Missing known definitions are seeded transactionally on writes. New publications carry `schema_hash` and `ui_hash` inside `definition`; old publications remain byte-for-byte unchanged. Re-registering a different schema under the same ID/version raises `TEMPLATE_DEFINITION_CONFLICT`. UI-only changes have a separate hash and do not overwrite prior publications. Schema hashes cover ID, version, target, permitted catalog kinds, legal paths, and JSON validation schema. The eight existing schema hashes are pinned in the Batch 4 contract tests. Existing cross-field validators were moved unchanged.

Retirement is represented by a code-registry entry's `retired` flag; stored publications with `definition.status='RETIRED'` are also read as retired. No existing template was retired and no administrative retirement command was added. Unknown and retired writes use the stable existing `ATTRIBUTE_VALIDATION_FAILED` code.

## Preservation and capabilities

Loads accept unknown IDs/versions and retired values as opaque objects. Detail/attribute-set/snapshot bindings expose `KNOWN`, `UNKNOWN`, or `RETIRED`. `flatten()` does not look up unknown definitions. Unchanged bindings keep their array positions, values and both timestamps; new bindings append. Saves reuse PostgreSQL's original JSONB text for unchanged bindings, avoiding JavaScript rounding of large numeric literals. The guarantee is JSONB-normalized preservation, not original whitespace or object-key order.

Move, rename, note and add-attribute writes preserve unknown/retired bindings. Explicit mutations, including no-op patches of a retired binding, reject. Existing facts are not deleted or pruned when profile/capabilities change. The final binding count is checked after automatic lifecycle effects as well as before validation.

Profiles resolve exactly to the frozen defaults. `capabilities=null` inherits, `[]` disables optional capabilities, and a supplied array replaces the defaults. Items inherit the SKU's result. Base fields remain available. New optional bindings require their resolved capability (including lifecycle expiry/opening field groups); existing bindings remain editable after capabilities are disabled. In particular, an unprofiled SKU resolves to `[]`; opt into an optional capability before adding a new optional binding.

Catalog create/update accept `profile`, `capabilities` and `one_off`, require `expected_revisions`, and retain the existing governance, revision, event, idempotency and transaction paths. Omitted update fields are unchanged; explicit null clears capabilities to inheritance. `record_state` is read-only in this lane; no void command or filtering behavior was added.

## Discovery and read integration

`list_attribute_templates` accepts `target_kind`, `catalog_node_id`, nullable `profile`, and `capability`. Unfiltered discovery returns all active latest definitions. Filters combine with AND. Catalog capabilities override profile defaults, including when a profile is also supplied. For catalog-target definitions, catalog kind must be permitted. Lifecycle remains a base template; filtered UI `fields` omit disabled optional groups while the published legal `paths` and validation schema remain unchanged. Unsupported capabilities such as `deadline` return no template in this release.

`get_connection_context` returns `protocol:{current:2,min:2}` and exactly `query_v2`, `history_v2`, `profile_capabilities`. It does not advertise deadline, sync, files, protocol enforcement or other future features.

Detail records and web snapshot records expose effective capabilities; snapshot records also include the new catalog fields, record states, timestamps, and binding statuses. The additive fields in the existing web cache types remain optional so pre-Batch-4 caches and existing consumers still typecheck. Current snapshot responses populate them.

## Verification

Database: PostgreSQL 18.6, `acornary_test_w2_registry`, already running at port 55432. Applied the migration chain through 013 using the supplied command; no Docker or PostgreSQL process was started.

```sh
DATABASE_URL=postgres://postgres@127.0.0.1:55432/acornary_test_w2_registry \
  ../../node_modules/.bin/tsx apps/server/src/migrate.ts
../../node_modules/.bin/tsc --noEmit
../../node_modules/.bin/tsc -p apps/web/tsconfig.json --noEmit
```

The repository Vitest config only includes `tests/*.test.ts`. Use a temporary config to select the lane tests without editing shared configuration:

```sh
cat > /tmp/acornary-batch4-vitest.config.mjs <<'CONFIG'
export default { test: {
  include: ['tests/batch4/*.test.ts', 'tests/domain.test.ts', 'tests/web-projection.test.ts'],
  fileParallelism: false, testTimeout: 30000, hookTimeout: 30000
} };
CONFIG
DATABASE_URL=postgres://postgres@127.0.0.1:55432/acornary_test_w2_registry \
  ../../node_modules/.bin/vitest run --config /tmp/acornary-batch4-vitest.config.mjs
```

| Case | Lane result | Evidence |
| --- | --- | --- |
| MODEL01 | PASS | Real DB unknown and retired reads; exact JSONB text, timestamps, array positions and numeric precision; move/rename/note/add binding preservation; direct mutation rejection and unchanged events for opaque payloads |
| MODEL02 | PASS | All five defaults, null profile, inheritance/empty/override, catalog writes, item inheritance, snapshots, revisions and retained facts |
| MODEL13 | PASS | Frozen schema hashes, independent UI hashes, immutable DB publication and legacy publication compatibility, generated write IDs, positive versions beyond 2, 16th binding accepted / 17th rejected atomically |

Batch 4 tests: **19 passed**, no skipped cases. Both typechecks pass. The final targeted run, including the existing domain and web projection regressions, passed **28 tests in 4 files**. The full suite was not run. `tests/batch0/cases.json` was read, not modified, because it is outside lane ownership.

## Boundaries and remaining integration work

- SQL query/cursor internals are untouched. Their current serializer preserves unknown values but still strips binding timestamps/status and does not add `effective_capabilities`; query DTO decoration remains an integration task outside the explicitly owned functions. Detail, attribute-set and snapshot paths supply the new metadata.
- Query profile/capability/one-off/record-state filtering, full snapshot-v2 reshaping, deadline, sync, notes/files, void/split and UI flows are outside this batch. Existing schema-specific aggregate/reminder projections were not generalized to interpret future template versions.
- Future upgrades need a new published validator and explicit registry edge. No speculative templates, migration guesses or runtime plugin registration were added.
- No blocker for the owned implementation. Cross-lane read projection integration remains as described above.
