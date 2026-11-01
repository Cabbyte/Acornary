# Batch 5: deadline and unified dates

Implemented on `codex/wave2-dates`, based on `codex/data-model-v2`. Only the seven owned files below changed; no dependencies were added.

| File                                 | Change                                                                                                                                                       |
| ------------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `migrations/014_deadline_dates.sql`  | Rebuildable projection, actionable index, source adapter, initial backfill, timezone write validation and timezone-change refresh, runtime projection grants |
| `packages/contracts/src/deadline.ts` | Deadline entry/template, completion's service template, DateFact/DateFilter types and validation                                                             |
| `packages/contracts/src/index.ts`    | Minimal template wiring, four commands/descriptions, template reads, date_filters                                                                            |
| `apps/server/src/dates.ts`           | Projection maintenance/rebuild, unified read conversion, calendar-day recurrence                                                                             |
| `apps/server/src/service.ts`         | Date query predicates/sort, flat detail dates, four command cases, transactional save hook                                                                   |
| `tests/batch5/dates.test.ts`         | 11 real PostgreSQL tests                                                                                                                                     |
| `docs/repair/batch5/dates.md`        | Implementation decisions, verification and handoff                                                                                                           |

## Write and projection behavior

`deadline` v1 is an ITEM binding with `entries`. `add_deadline` generates `deadline_<uuid>`; update/remove/complete resolve that ID on the addressed item. Client-supplied IDs or completion fields on add/update, array-index patches, invalid calendar dates, invalid kinds and nonpositive recurrence are rejected. Commands retain the existing household authorization, revision checks, idempotency and operation receipts.

Completion records `last_completed_on` in the binding and the append-only event. Recurrence advances from explicit `completed_on`, not the prior due date or today's date. Date-only arithmetic uses a UTC calendar carrier without converting the household date into an instant, so leap days and 23/25-hour DST days do not change the number of calendar days advanced. `SERVICE_DUE` completion also changes `service.last_service_on` in the same item revision/event/transaction. Existing service fields are retained. There is no service next-date copy or interval-derived second deadline.

One-off completion retains its entry and projects non-null `completed_on`, hence `COMPLETED`; recurring entries retain last completion in the binding/history but project null `completed_on` for the next actionable occurrence. Repeating the same completion day is a no-op; a different completion day on an already completed one-off is rejected. Update keeps completion history intact. Changing recurrence to null therefore makes an already completed recurring entry non-actionable; adding recurrence makes it actionable again. No separate mutable status column was introduced.

The save hook runs after the event and existing sync-change insert, in the same transaction. The projection carries the current household change watermark; it does not allocate a second change ID. Failure in projection maintenance rolls back the item, service completion, event, sync change and receipt. Food dates remain solely in lifecycle. Source keys are `lifecycle.expiry`, `lifecycle.opening`, and `deadline`, with stable deadline IDs in `entry_id` (empty string for lifecycle singleton rows).

The existing static validation map needs two minimal entries for deadline and service; their definitions live in the new deadline module. This is necessary for existing load/save validation and flattening to accept the completion result. Existing registrations are never overwritten: commands seed missing definitions; new household initialization already iterates the map. Generic attribute-write enums are unchanged, so deadline entries can only be changed through the four commands. Registry/profile/capability infrastructure is not implemented here.

## Reads and timezone

`get_item` stays flat and adds `dates` plus nullable `reminder_date`. `query_items` exposes the same date fields. The legacy `reminder` object, including lifecycle basis ordering, remains compatible. The unified reminder is the earliest uncompleted due date, or null. Completed facts remain visible in details and are available to explicit completed-state queries.

Every DateFilter becomes one EXISTS predicate: its kind/source/inclusive bounds/state must match one row. Separate filters are ANDed, and may match distinct rows. Filters participate in cursor identity and whole-match-set statistics. Reminder keysets keep nulls last in both directions. Projection reads use the source adapter as a compatibility fallback for items with no projected rows, including directly imported legacy items; normal writes always maintain the table.

Unknown dates produce no invented DateFact, `dates: []`, and `reminder_date: null`. The frozen `UNKNOWN` enum is accepted, but an item without a date does not satisfy an EXISTS filter for a DateFact. All currently supported facts have a required due date; no placeholder date or nullable due-date column was added.

Migration 014 validates timezone on every household INSERT or UPDATE targeting timezone, using PostgreSQL named timezone data (including existing aliases). It does not rewrite any stored string or retroactively reject legacy rows. Invalid legacy timezones use UTC for date calculations so reads do not throw. Valid timezone changes refresh derived dates without changing item revisions or events. Calendar-day recurrence itself does not depend on the current clock.

Input limits follow existing local conventions: recurrence and service intervals are capped at 36,500 days; basis/provider at 500 characters; notes at 100,000. Recurrence beyond the four-digit supported date range is rejected. These are implementation limits, not new source fields.

## Rebuild/backfill

Call from a READ COMMITTED transaction using the existing database client:

```ts
await transaction((c) => rebuildDateFacts(c, householdId));
// Or, after an item source write in its transaction:
await recomputeItemDates(c, householdId, itemId);
```

Both helpers acquire the existing household advisory lock before reading source facts. Rebuild is household-scoped, replaces rows from attributes, and changes neither core revisions nor events. It may advance projection watermarks to the current household watermark. No worker is needed. Direct imports must recompute affected items or run the household rebuild; partially stale projections from out-of-band SQL are not automatically repaired by reads.

The migration grants SELECT/INSERT/DELETE on date_facts when `acornary_app` already exists. If deployments create that role _after_ migration 014, the deployment owner must run `GRANT SELECT, INSERT, DELETE ON date_facts TO acornary_app` alongside its existing grants step. `deploy/grants.sql` is outside this lane's ownership and was not changed.

## Verification

Database: `postgres://postgres@127.0.0.1:55432/acornary_test_w2_dates`, PostgreSQL 18.6. No Docker or PostgreSQL process was started. After initial development checks, only this lane's generated fixtures were reset and all migrations were reapplied from an empty schema with the finalized 014; a second runner invocation with `--grants` also passed.

```sh
DATABASE_URL=postgres://postgres@127.0.0.1:55432/acornary_test_w2_dates ../../node_modules/.bin/tsx apps/server/src/migrate.ts
DATABASE_URL=postgres://postgres@127.0.0.1:55432/acornary_test_w2_dates ../../node_modules/.bin/tsx apps/server/src/migrate.ts --grants
../../node_modules/.bin/tsc --noEmit
../../node_modules/.bin/tsc -p apps/web/tsconfig.json
```

Both typechecks passed. The root Vitest configuration excludes nested batch tests, so targeted execution used an external temporary config (no repository configuration changes):

```sh
cat > /tmp/acornary-batch5-vitest.config.mts <<'CONFIG'
export default { test: { include: ['tests/batch5/*.test.ts', 'tests/batch2/query-cursors.test.ts', 'tests/batch2/query-database.test.ts'], fileParallelism: false, testTimeout: 30000, hookTimeout: 30000 } };
CONFIG
DATABASE_URL=postgres://postgres@127.0.0.1:55432/acornary_test_w2_dates ../../node_modules/.bin/vitest run --config /tmp/acornary-batch5-vitest.config.mts --silent=passed-only
```

Result: **30 passed, 0 failed, 0 skipped**, three files (11 Batch 5 + 19 Batch 2), 9.33 seconds. Full suite intentionally not run.

| Case                  | Result                    | Evidence                                                                                                                                                                                                 |
| --------------------- | ------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| MODEL03               | PASS                      | Stable IDs; one source for service deadlines; one event/revision for service completion + recurrence; idempotent replay; stale revisions; forced projection failure rollback; deterministic rebuild      |
| QUERY07               | PASS                      | Real rows with mismatched kind/range/source/state; inclusive equal bounds; AND across filters; original lifecycle attribute filters still pass                                                           |
| QUERY02/03 regression | PASS                      | Existing cursor/statistics tests plus reminder null keysets and filter-bound cursors                                                                                                                     |
| Dates/timezone        | PASS                      | One-offs, completion/removal/history, recurring leap day and both DST transitions, DUE/OVERDUE/UPCOMING, unknown reminder, timezone insert/update rejection, legacy-invalid reads, timezone reprojection |
| Runtime projection    | PASS                      | Rebuild under SET LOCAL ROLE acornary_app; required partial index inspected                                                                                                                              |
| QUERY08               | PARTIAL (unchanged scope) | Existing small-fixture SQL count/EXPLAIN checks pass; no 10k/100k performance benchmark                                                                                                                  |

`tests/batch0/cases.json` was read but not edited because it is outside the owned files. Integration should update MODEL03 with this evidence.

## Handoff / known gaps

No implementation blockers. The Batch 4 integrator must retain command-only deadline writes when consolidating template enums and reconcile the frozen service definition with its registry. Feature advertisement, profile/capability policy, snapshot-v2/Web UI dates and sync envelopes remain in their owning lanes; no frontend availability is implied. Existing web snapshot shapes were not changed. Runtime roles created after migration need the explicit projection grant described above. No large-scale backfill/performance claim is made.
