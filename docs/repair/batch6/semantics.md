# Batch 6 backend semantics

Implemented on `codex/wave3-semantics`, based on the frozen interfaces and storage contracts. Migration `017_semantics.sql` is additive: `voided_at` on both core tables, `attribute_references`, and `item_splits`. Existing record-state columns, published templates, lifecycle values, events, and measurements are not rewritten. No Batch 8 protocol/constraint work or client changes are included.

## Contract and implementation

- `packages/contracts/src/semantics.ts`: typed ACTOR/ITEM/CATALOG_NODE/EXTERNAL references; usage, custody, transport, wardrobe, asset, stock, disposition schemas and DTOs. The already-published service v1 definition is reused unchanged from the deadline contract. There is no lifecycle v2.
- `packages/contracts/src/units.ts`: dimension registry and isolated 200-digit Decimal arithmetic; mg/g/kg → g, mL/L → mL, mm/cm/m/in → mm, W, Wh/kWh → Wh, V. Count remains integral; percent stays independent and bounded. Money is a separate decimal amount and ISO currency, never converted.
- `packages/contracts/src/catalog-v2.ts`: clothing v2 structured size (`label`, optional `system` and named length measurements) and care; device v2 connector arrays and electrical power/voltage/energy quantities; contents v2 supports normalized mass/volume/length/count/percent. Explicit 1→2 edges require complete caller-supplied values. Old clothing strings and connectors are never inferred into structured fields. Product v1/v2 and all old template schema hashes stay unchanged.
- `apps/server/src/references.ts`: same-household existence checks and replacement of reverse-index rows inside the owning write transaction. External names never create actors. `query_references({target})` returns source kind/ID/template/path for valid sources. Void-source facts remain available in explicit object/history reads; their reverse rows do not count as active business references. Unknown future binding versions remain opaque.
- `apps/server/src/semantics.ts`: void/split preconditions, split provenance projections, exact conservation, and stock calculation. Split metadata is projected in the existing item-list SQL, preserving its bounded query count; details and sync snapshot DTOs also expose it.
- `service.ts`: shared command pipeline, expected revisions, operation receipts, events, transactional reference/index maintenance, filters, and `query_stock`. Void/archive producers call the existing `publishSyncTombstone` primitive in the same transaction. Restoring a void item uses `correct_item` with a reason and emits an upsert. `voided_at` and record state are included in event deltas.
- `intake.ts`: only explicit IDs, unique authoritative barcode/confirmed alias matches, or complete nonempty configured identity signatures can auto-reuse. Name-only candidates require selection. `one_off` is explicit, excluded from normal suggestions/automatic matching, and omitted from `query_catalog_nodes` unless `include_one_off=true`; its physical items remain visible. No shared MISC SKU is introduced.

New feature keys are `stock`, `void`, `split`, `references`, and `units_v2`.

## State, void, and split rules

Legacy `lifecycle.availability` is readable and filterable, but cannot be added, removed, or changed. New facts never backfill or dual-write it. Derived availability is null unless sufficient explicit facts exist; explicit blocking facts can establish unavailability. Usage, custody, service, transport, and physical location remain independent. Dates reserved for deadline are rejected by the new schemas.

`dispose_item` records disposition and DISPOSED in one event. Generic attribute mutation cannot introduce terminal state, disposition, or zero-content consumption as a bypass. Reasoned correction and existing consumption commands remain available.

`void_item` keeps identity, attributes, and history; it rejects direct children and any valid transitive split descendants. Default item/catalog queries and snapshots omit VOID. Explicit ID detail/history reads remain audit reads; list audit access uses `include_void=true`. `include_terminal` now follows the frozen default false. Ordinary edits cannot revive VOID, and new placement cannot use a void SKU/container.

`void_catalog_node` requires the existing catalog governance proposal/challenge/approval flow, and only permits SKU. It rejects any items (including historical/void items), children, barcodes, identity keys, active reverse references, policy aliases/exceptions, installation/settings references, active notes, or attachments. It removes its owned outgoing reference projection in the same transaction; unused barcode/identity projections are necessarily empty. No automatic unlinking occurs.

`split_item` accepts one explicit target SKU and 1–100 identical child attribute sets. The source must have known positive additive contents, no children, no prior split, and a nonterminal valid state. Child contents must be explicitly supplied in `child_attributes`; omission is rejected rather than guessing child quantity from a SKU or package count. This is the conservative interpretation of the optional frozen `child_attributes` input. Counts only conserve against counts; mass/volume/length only conserve within the same dimension. The source becomes CONSUMED with zero contents, while children and all provenance rows commit together. Only supplied child facts are used; serial/IMEI/MAC, price, and opening facts are forbidden. Children inherit the source's physical location, not its ID as parent. Split sources cannot be restored even after all descendants are void; no merge command is provided.

## Stock and identity details

`query_stock` implements the frozen result fields and opaque household/condition-bound pagination, stable initial watermark, stale detection, catalog/subtree/location scopes, and `low_only`. Aggregation covers all matching current items, not the page. COUNT includes unknown lifecycle and excludes terminal/VOID. CONTENT sums only the policy's normalized unit; missing quantities, percentages, and other units contribute to `unknown_count`. A known subtotal at/above threshold proves `low=false`; otherwise unknown content yields `low=null`. Gap is unknown while content is incomplete. Missing threshold/target stays null. Target below threshold is rejected, and no purchase/inventory mutation is generated.

`rebuildIdentityIndex(client, household)` is exported as a transaction-scoped administrative primitive: callers must hold the household write lock. It runs after catalog changes and policy confirmation. It skips void/one-off/empty/incomplete signatures, replaces derived keys, and returns `{indexed, conflicts}`. Conflicting keys are omitted instead of assigning a winner; all SKU IDs survive. Catalog write results and policy confirmations report `identity_conflicts`; intake receipts report conflicts when creating catalog records. Existing households can explicitly run the same primitive during rollout; migration 017 does not guess historical identity values. Policies selecting new device identity should explicitly select `device.electrical`; old identity field selections are preserved.

Original quantity inputs are retained in event change metadata (`quantity_input`, with request paths/value/unit), alongside canonical attribute changes. This metadata contains quantity facts only, not copies of notes, serials, or arbitrary request fields.

## Verification

Database: `postgres://postgres@127.0.0.1:55432/acornary_test_w3_semantics`, PostgreSQL 18.6. The lane database was recreated after the final migration edit; all migrations applied from empty, followed by the existing `deploy/grants.sql` unchanged. Migration 017 grants SELECT/INSERT/DELETE on the reverse projection and SELECT/INSERT on split provenance when `acornary_app` exists. If a deployment creates that role after migrations, apply equivalent grants at role setup.

| Cases               | Result | Evidence                                                                                                                                                    |
| ------------------- | ------ | ----------------------------------------------------------------------------------------------------------------------------------------------------------- |
| MODEL04 / D12 / S11 | PASS   | One disposition event, lifecycle v1, idempotent replay, terminal bypass rejection                                                                           |
| MODEL05 / D11–D12   | PASS   | Governance, SKU references, child guards, VOID audit/default reads, restore history, tombstone/upsert, runtime projection privileges                        |
| MODEL06 / D14       | PASS   | Count/content conservation, cross-unit rejection, rollback, concurrent split conflict, no implicit copied facts, source restore rejection                   |
| MODEL07 / D13 / D18 | PASS   | All six dimensions, exact large decimals, canonical writes plus original inputs, unchanged old bindings, asset amount/currency and deadline-field rejection |
| MODEL08 / D15       | PASS   | COUNT/CONTENT, unknown values, low/gap, scopes, full matching counts, stale and condition/household-bound cursors                                           |
| MODEL09 / D16       | PASS   | Name-only ambiguity, explicit selection, one-off catalog/auto-match exclusion, empty-signature omission, complete identity reuse                            |
| MODEL10 / S13       | PASS   | Normalized GROUP sibling duplicate rejection, duplicate SKU names allowed                                                                                   |
| MODEL11             | PASS   | Explicit clothing/device upgrades, rebuilt conflicting identity keys omitted, both SKUs retained                                                            |
| MODEL14 / D11       | PASS   | Actor/item/catalog references, replacement/removal, foreign/missing rejection, rollback, external names without actors, opaque future bindings              |
| MODEL15 / D10 / S12 | PASS   | Legacy LOANED/AVAILABLE remain unknown, independent state writes, read-only legacy field, service filtering                                                 |

- Batch 6: **23 passed**, two files (`contracts.test.ts`, `database.test.ts`).
- Targeted regressions: **40 passed**, `batch1/sync-writes`, `batch2/query-cursors`, `batch4/registry`, `batch5/dates`. This includes unchanged published schema hashes and the five-statement list query assertion.
- Root TypeScript and Web TypeScript: passed.
- Full suite and performance benchmarks: not run, per lane scope. Old Batch 2 database fixtures that assert terminal-inclusive defaults were not used as the new frozen default is terminal-exclusive; the new tests cover explicit inclusion.

Reproduction from this worktree (the root Vitest configuration only discovers `tests/*.test.ts`, so use a temporary config):

```sh
DATABASE_URL=postgres://postgres@127.0.0.1:55432/acornary_test_w3_semantics ../../node_modules/.bin/tsx apps/server/src/migrate.ts
../../node_modules/.bin/tsc --noEmit
../../node_modules/.bin/tsc -p apps/web/tsconfig.json
cat > /tmp/acornary-batch6-vitest.mjs <<'CONFIG'
export default { test: { include: ['tests/batch6/*.test.ts'], fileParallelism: false, testTimeout: 30000, hookTimeout: 30000 } };
CONFIG
DATABASE_URL=postgres://postgres@127.0.0.1:55432/acornary_test_w3_semantics ../../node_modules/.bin/vitest run --config /tmp/acornary-batch6-vitest.mjs
```

No current implementation blocker. Performance at production scale and client rollout remain integration work; identity rebuild currently scans the household catalog, and stock aggregation loads the selected SKU inventories. No UI, Android, note/attachment/sync/label/deadline internals, or Batch 8 enforcement were changed.
