# Batch 1 · Sync foundation

Scope: migration 011, household state, and one application hook immediately after the event insert in `service.ts`'s `save()`. This follows the explicit Batch 1 lane assignment; the broader design in `03-sync-state-machine.md` is not a claim of implemented Batch 3 behavior. No client state machine, initial catch-up, cursor API, pruning, reset, projection fan-out, or payload snapshot is delivered here. `tests/batch0/cases.json` and its Batch 3 SYNC statuses are unchanged.

## Transaction and storage behavior

- `011_sync_changes.sql` creates the requested tables and `(household_id, change_id)` index. Existing households receive distinct generations and zero watermarks; existing objects do not receive synthetic log entries.
- Every successful, changed `save()` inserts one `UPSERT`, with its object identity, `rev + 1`, current operation ID, payload version 1, and NULL `after_image`. No note-specific hook exists.
- `recordSyncChange()` uses the caller's connection. A data-modifying CTE inserts the log and upserts the household watermark using `GREATEST` in one statement. Change IDs never leave PostgreSQL in this helper, so there is no JS Number conversion. Future readers must return decimal strings (or use BigInt internally).
- The existing command transaction holds its household advisory lock before reaching `save()` and allocating an ID. Source data, events, log, state and operation receipt commit or roll back together. The helper must only be called inside that transaction/lock boundary; it neither acquires another lock nor commits.
- `save()`'s existing no-change return and the command's existing idempotency return precede the hook. They allocate no change ID and do not touch state. Failed transactions may leave sequence gaps, but no committed log or watermark change.
- A household created after 011 receives its state lazily on its first changed `save()`. This avoids changing household initialization outside the owned scope. Until then it has no state row; any future sync reader must handle this explicitly. Migration backfill does create state for every household that exists at migration time.

## Existing write paths

The common hook covers the following paths by code inspection. The tests below exercise representative paths, not exhaustive acceptance of every future write path.

| Existing path                                                                                  | Logged object / behavior                                                                                                 |
| ---------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------ |
| `create_catalog_node`, `update_catalog_node`, `move_catalog_node`                              | One CATALOG_NODE per changed save, after existing approval checks                                                        |
| `create_items`, `create_items_batch`                                                           | One ITEM per created instance                                                                                            |
| `update_item`, `edit_item`, `move_item`, `move_items`                                          | One ITEM per changed target; combined edit plus note still calls save once                                               |
| `open_item`, `consume_item_content`, `consume_items`, `update_items_lifecycle`, `correct_item` | One ITEM per changed target                                                                                              |
| `bind_attributes`, `update_attributes`, `remove_attributes`, `upgrade_attributes`              | Owning ITEM or CATALOG_NODE; product barcode changes and barcode-index maintenance accompany the catalog save            |
| `add_note`, `update_note`                                                                      | Owning ITEM only, including its incremented revision; unchanged note text produces no log                                |
| `commit_intake`                                                                                | Its nested domain creates use the same save hook and outer operation ID; reused unchanged catalog objects produce no row |

## Known gaps and assumptions

- This application hook implements one row per changed save, as explicitly requested for this lane. It is not the design document's deferred database dirty-object collector. Current command loops reject duplicate targets or create distinct IDs. If a future transaction saves the same object repeatedly, this hook would emit multiple rows; final-image coalescing still needs an explicit implementation.
- Catalog policy versions, proposal creation/review/confirmation/consumption, and direct catalog identity-key maintenance in `intake.ts` do not call save. They have no separate sync entries. A catalog command executed after approval does log its actual catalog change. Policy/proposal synchronization and representation remain later work.
- `createHousehold()` directly inserts its hidden container SKU, templates and settings. Bootstrap, direct SQL, migration/maintenance backfills, and old application versions bypass this hook. No fabricated user operation IDs or synthetic maintenance entries are added. Integrators must register maintenance provenance and generation invalidation before treating such writes as synchronizable.
- Profile/timezone changes, borrow/return/maintenance, disposition, void/split, archived notes, attachment confirmation/unlinking, and projection fan-out are later work. There are no new hooks for these. Upload staging bytes and authentication/audit-only tables are not inventory changes.
- Catalog rename/move and parent-item changes log the changed core object only. Dependent display/search/label projections are not fanned out. All current log entries are UPSERT; the schema permits TOMBSTONE for later implementations.
- The current hook is an application convention, not database enforcement that all writers log or that runtime callers cannot forge a log/watermark. The design's stronger database-only mutation boundary and deferred flush are not implemented here. Coordinate privilege/immutability work with the owning lane; do not claim that these two requirements are already satisfied.

## Required grants (handoff only)

`deploy/grants.sql` is unchanged. Its existing SELECT-on-all-tables grant must run after 011. The runtime role additionally needs the following privileges for this helper; otherwise successful domain writes fail and roll back:

```sql
GRANT SELECT ON sync_changes, household_sync_state TO acornary_app;
GRANT INSERT (household_id, object_kind, object_id, revision, change_kind, operation_id, after_image)
  ON sync_changes TO acornary_app;
GRANT USAGE ON SEQUENCE sync_changes_change_id_seq TO acornary_app;
GRANT INSERT (household_id, last_committed_change_id), UPDATE (last_committed_change_id)
  ON household_sync_state TO acornary_app;
```

These are the direct privileges required by the delivered application hook. They do not grant runtime log UPDATE/DELETE, state DELETE, generation/pruning updates, or sequence reset. They still allow a runtime role to insert arbitrary log rows and raise watermarks, so they do not implement the stronger database-only boundary described above. The grant/immutability owner must resolve that boundary if it is a Batch 1 integration gate; no security-definer API or extra trigger has been invented in this lane.

## Validation and integrator steps

1. Integrate this commit with the operation-integrity, migration-runner, household-lock and grants lanes. Preserve the import and single hook after the event insert; do not duplicate the hook for notes or intake. Apply migrations with the migration role before running the updated server, then apply the approved grants. Confirm household serialization still precedes ID allocation.
2. Use a disposable PostgreSQL database with a name containing `acornary_test` and set `DATABASE_URL`. The tests use the real migrations, `createHousehold()`, command execution and catalog approval helpers. They retain isolated per-test households in that disposable DB; the two migration-specific fixtures create transactional schemas that roll back. No Docker or PostgreSQL process is started by the tests.
3. Run the targeted suite with the command below. Root `vitest.config.ts` currently includes only `tests/*.test.ts`, so the requested literal CLI command finds no nested tests. This programmatic equivalent overrides only test discovery, without editing the shared config:

```sh
node --input-type=module -e 'import { startVitest } from "vitest/node"; const ctx = await startVitest("test", ["tests/batch1/sync-"], { include: ["tests/batch1/sync-*.test.ts"], reporters: ["dot"], watch: false }); await ctx?.close();'
```

4. All 13 DB cases must run: item creation/lazy state, move/generation preservation, note create/update/combined edit, catalog create/rename, no-change item/note, idempotent replay, rollback with absent and existing state, count/explicit/consume batches and increasing IDs, intake batch, household isolation, migration backfill, and bigint precision/GREATEST. Separately smoke-test a write as `acornary_app` after the grants lane integrates; this suite's migration role does not validate runtime grants. Confirm the transaction's event/log/receipt pairing against the integrated operation constraints.
5. Do not enable Batch 3 sync semantics or mark Batch 3 SYNC cases passed based on these tests. An old server without this hook creates log gaps and cannot be used as a transparent rollback once a consumer relies on the log.

Local results (2026-10-31):

- `../../node_modules/.bin/tsc --noEmit`: passed.
- `../../node_modules/.bin/vitest run tests/batch1/sync-*.test.ts --reporter=dot`: exit 1, no files found because of the existing root include pattern.
- Targeted programmatic command above: exit 0, 13 DB tests cleanly skipped because no `DATABASE_URL` is present. PostgreSQL behavior remains unverified locally.
- `../../node_modules/.bin/vitest run tests/domain.test.ts --reporter=dot`: 8 passed.
- No full suite, Docker/PostgreSQL startup, production connection, grants edit, or Batch 0 evidence/status edit.

Integration blockers: actual PostgreSQL execution and runtime grant verification are pending; the required runtime privileges are not delivered by this lane. The stronger database-only mutation boundary is an explicit unresolved integration decision, not hidden behind a passing test claim.
