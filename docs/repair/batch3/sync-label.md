# Batch 3 backend: sync, snapshots, groups and label projection

Implemented on `codex/wave2-sync`, based on `codex/data-model-v2`. Scope is backend only. No Web/Android cache, UI, registry/profile, date-fact, note/archive, attachment, void or split producers were changed.

## Interfaces and compatibility

- `GET /api/sync/state`, `GET /api/sync/changes`, `GET /api/sync/bootstrap`, `POST /api/sync/fetch` require `X-Acornary-Protocol: 2`. They use the existing cloud session/household middleware and the existing local-host context. A cloud request without a session returns 401 on all four routes; no local-context fallback occurs. The existing terminal OAuth route namespace is unchanged.
- `changes` requires `generation` and decimal `cursor`; `limit` defaults to 100, maximum 200. The first page captures a household high watermark H. Pass its `as_of_change_id` on subsequent pages to keep H fixed. `next_cursor=null` completes that round; advance to `as_of_change_id` even for an empty round. A generation mismatch, cursor below the pruning boundary, future cursor, or invalid H returns HTTP 409 `SYNC_RESET_REQUIRED`. A cursor equal to the pruning boundary is valid. Malformed/cross-household bootstrap cursors return `INVALID_CURSOR`.
- Bootstrap uses database keyset pages over catalog IDs, then item IDs, then group/SKU IDs. Its opaque cursor retains household, generation and initial S. Every page returns S as `as_of_change_id`. After paging, read changes after S, pin H, fetch referenced objects, and continue until an empty catch-up round. `last_change_id` is an additive per-object field, retained independently of log retention; do not use core revision or a page's S to reject newer projections.
- `fetch` queries requested object IDs within the authenticated household. Missing/tombstoned/foreign IDs are omitted. Catalog/items have v2 DTOs; existing notes have summaries only, without a `body` field. Attachment producers/storage are not present in this base, so attachment IDs yield no objects. The additive `groups` field returns complete server aggregates for the fetched items' current SKUs and fetched catalog IDs. For a removed or reassigned item, refresh affected prior groups through `query_inventory_groups`; clients must not derive aggregates from fetched subsets.
- Tombstone publication is the internal `publishSyncTombstone` transaction primitive. It only publishes identity/revision/order, uses the household lock and updates the existing watermark. A future void/archive/delete producer must mutate its source and write its event/receipt in that same transaction. No void/archive write command was added in this lane.
- `GET /api/ui/snapshot` without a protocol header retains the old shape, including its existing notes and filters. Protocol 2 returns the frozen outer SnapshotV2 fields, explicit v2 records with `note_count`, and server groups, with no note bodies or group `item_ids`. Unknown explicitly supplied snapshot protocols return 409. The current Web client remains on v1.
- `query_inventory_groups` is available through the existing GET read transport, MCP, and the frozen `POST /api/read/query_inventory_groups`. It uses the **same SQL matching CTE as query_items**, before pagination, and a shared server aggregate for v2 snapshots/bootstrap/fetch. It includes matching containers just as query_items does; it does not reuse v1's extra container exclusion or search filtering. Decimal quantities remain strings; independent percentages are not summed.
- Group pagination uses ascending SKU ID and adds optional `next_cursor` because the frozen response omitted a continuation field despite accepting `cursor/limit`. `matching_group_count` covers the entire matching set; conditions/household changes invalidate the cursor; concurrent writes mark subsequent pages stale. Its returned watermark describes the current aggregate snapshot.
- Connection context advertises only the existing query/history and newly implemented snapshot/groups/sync features. It does not advertise protocol enforcement for all legacy business routes.

## Deliberate base-model limits

The frozen document explicitly marks profile/capability/date/void filters as future work. Groups accept precisely the currently implemented query_items filters (minus include_path/sort), including normalized search/name AND, SKU/subtree/location scope, barcode and same-binding attribute predicates. They retain query_items' current inclusion of terminal records. Future filter names are rejected rather than silently ignored. Their producers and shared query semantics must be integrated in their owning lanes.

Until those model lanes land, v2 records use `profile=null`, `capabilities=null`, `effective_capabilities=[]`, `one_off=false`, `record_state=VALID`, `voided_at=null`, `attachment_count=0`, `next_date=null`, `split=null`, and empty redacted paths. Group `next_date=null`, `overdue_count=0`, `low_stock=null` likewise do not claim date-fact or stock support. Known existing template versions receive KNOWN; unrecognized bindings remain intact with UNKNOWN. No registry was introduced. Existing note summaries use the frozen excerpt/archived/sensitivity fields; last editor comes from recorded note-change events, falling back to the creator for legacy history. They remain unarchived/NORMAL until the notes/sensitivity lane adds those source fields.

## Migration and maintenance

`015_sync_label_snapshot.sql` adds:

- `items.label_hash`, `label_updated_at`, `projected_through_change_id`, plus the missing-label partial index.
- `sync_object_versions`, initially populated from Batch 1 references and maintained by an insert trigger, preserving last object change IDs/tombstones after pruning. It does not replace `sync_changes` or `household_sync_state` as the log/state source.
- Expanded sync object kinds and an `after_image IS NULL` check.
- `label_projection_checkpoint` and the grants for an already-existing `acornary_app` role. If the role is created after this migration, apply the standard deployment grants plus `GRANT SELECT,INSERT,UPDATE ON label_projection_checkpoint TO acornary_app`; the standard grants already cover reading the new object-version table and updating item columns.
- Administrative SQL functions `prune_household_sync(household_id)` and `reset_household_sync(household_id)`, revoked from PUBLIC. Run as the migration/admin role. Pruning holds the household lock and removes only the contiguous prefix older than 30 days, stopping before the first retained row even when timestamps are out of order; deletion and pruned-through advancement commit together. Reset rotates generation under the same lock; database restore procedures must call it before exposing the restored database.

Applied successfully on PostgreSQL 18.6 at `postgres://postgres@127.0.0.1:55432/acornary_test_w2_sync` with:

```sh
DATABASE_URL=postgres://postgres@127.0.0.1:55432/acornary_test_w2_sync ../../node_modules/.bin/tsx apps/server/src/migrate.ts
```

No Docker/Postgres startup, database recreation, or full-suite run was performed. The bigint test advances the dedicated test database sequence above JavaScript's safe-integer range; this is intentional and does not touch another database.

## Label projection and backfill

`save()` invokes `projectLabels` after writing the source event/reference in the existing transaction and household lock. The hash covers exactly the frozen four-tuple. Only effective content changes update label time; the value is the source event's `recorded_at`, floored at item `created_at`. Custom names mask SKU names; specification updates reach custom-named items too; null/empty fall back while whitespace remains literal; equivalent SKU reassignment and date-kind-without-date preserve time. Positions, notes, content quantities and opening do not change it.

Changed SKU label projections publish ITEM references even when core revisions remain unchanged. All 500 item updates/references commit atomically with the SKU event. `projected_through_change_id` tracks processed source changes; public `last_change_id` tracks the object's published read projection separately.

Backfill is an online TypeScript maintenance API in `label-projection.ts`:

1. `captureLabelBackfill(householdId)` reads H, all relevant source rows, and historical label events in a repeatable-read snapshot, using the original terminal-label-history reverse-history algorithm. It returns hashes/timestamps for batching.
2. `applyLabelBackfill(capture, batchSize=200)` writes under household locks in small transactions. It updates only still-missing rows whose projection watermark is at most H, committing the row batch and checkpoint together. Replaying a capture is safe; after interruption recapture/replay only fills missing rows, and never overwrites newer foreground projections. Checkpoints record the last completed ID/H for operational inspection.
3. Foreground save hooks are active throughout; H+ updates are projected synchronously. A legacy row first touched by an ordinary write is resolved from its history before projection, so a non-label edit cannot invent a new label timestamp.
4. `terminalSnapshot` calls an indexed missing-row check; if needed it performs this one-time legacy backfill, then reads stored timestamps. Normal terminal snapshots never scan events. The frozen history oracle remains unchanged.

Production-copy full comparison is **NOT_RUN**, since no replica was supplied. The integration test independently compares new foreground projection results against `tests/batch0/label-oracle.ts`, including the 500-item fixture. A production rollout must additionally report total/compared/mismatch/missing-ID counts and algorithm summary against the replica, with per-object output restricted to mode 0600. Synthetic equality is not a substitute for that gate.

## Verification and case status

Typecheck: both root and Web TypeScript checks pass. Targeted regression run: **45 passed, 4 skipped, 0 failed**, four files. The root Vitest config only includes `tests/*.test.ts`, so nested cases are run with an explicit programmatic include (no unowned configuration changes):

```sh
DATABASE_URL=postgres://postgres@127.0.0.1:55432/acornary_test_w2_sync LOG_LEVEL=silent node --input-type=module -e "import { startVitest } from 'vitest/node'; const files = ['tests/batch3/sync-label.test.ts', 'tests/batch1/sync-writes.test.ts', 'tests/batch2/query-database.test.ts', 'tests/terminal-label-history.test.ts']; const v = await startVitest('test', files, { include: files, watch: false }); await v?.close();"
../../node_modules/.bin/tsc --noEmit
../../node_modules/.bin/tsc -p apps/web/tsconfig.json
```

| Case | Status | Evidence / limits |
| --- | --- | --- |
| SYNC01 | PASS (server) | Modify an already-read bootstrap item; catch-up fetch returns its newer object watermark. |
| SYNC02 | PARTIAL | Internal tombstone during bootstrap excludes the unread object, identity-only log and empty fetch verified; actual void/archive producers belong to later lanes. |
| SYNC03 | PASS (server) | Name/update-time changes cannot move identity-based bootstrap page keys. |
| SYNC04 | PASS | Two real writers commit different households in reverse global ID order; no uncommitted or foreign watermark leaks. |
| SYNC05 | PARTIAL | Fixed-boundary page replay verified; IndexedDB/Room atomic page+cursor persistence is client-only and skipped. |
| SYNC06 | PASS | Rollback and inter-household holes, >2^53 IDs, numeric ordering across decimal-length boundaries. |
| SYNC07 | PASS | Continuous 30-day prefix pruning, equal boundary valid, older cursor reset, persistent object versions. |
| SYNC08 | PASS (server) | Administrative generation rotation invalidates changes/fetch/bootstrap; foreign/future cursors rejected. Actual database restore orchestration belongs to operations. |
| SYNC09 | PASS | Inherited SKU label changes publish item projections without increasing core revision; custom-name masking verified. |
| SYNC10 | PARTIAL | Three real connections pause a 500-item write mid-projection; readers see all old data until commit; fixed-H changes span pages. Client staging/publication assertions skipped. |
| SYNC11 | CLIENT-ONLY / SKIPPED | 20-round cap and backoff are the client cache state machine; HTTP backend is stateless. |
| SYNC12 | PARTIAL | Existing Batch 1 save-path coverage plus no-op/replay/rollback and label fan-out pass. Future registry/date/archive/attachment/void/split producers remain outside this lane; notes still invalidate their owning ITEM through Batch 1. |
| LABEL01 | PARTIAL | Independent frozen oracle comparison on real synthetic DB fixtures passes; production-copy full comparison NOT_RUN. |
| LABEL02–LABEL06 | PASS | Masking, null/empty/whitespace legacy names, equivalent reassignment, invisible date kind, unrelated edits. |
| LABEL07 | PASS | 500-item specification fan-out includes custom names; atomic visibility and exactly 501 sync references verified. |
| LABEL08 | PASS | Real repeatable-read connection retains old snapshot while a foreground write commits; stale backfill/replay cannot overwrite it. |
| LABEL09 | PASS | Creation floor and recent-seven-day terminal selection equal the frozen oracle; client occurred_at does not supply label time. |

Remaining integration obligations are the explicitly excluded producer/client lanes and the unavailable production replica. No backend test failures or dependency blockers remain. A pre-existing Fastify `disableRequestLogging` deprecation warning is emitted by HTTP tests.
