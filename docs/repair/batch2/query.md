# Batch 2 query lane

Implemented on `codex/wave1-query`. No database or performance acceptance is claimed: this environment has no `DATABASE_URL`. No PostgreSQL/Docker process was started. QUERY09 remains an integrator/sync-lane follow-up because barcode maintenance belongs to `save()`.

## Changes and boundaries

- `apps/server/src/service.ts`: browse/history read helpers only, plus the watermark import. SQL filters, recursive subtree membership, stable keysets, SQL LIMIT, full-matching-set aggregates, page-batched notes and embedded bindings, joined SKU names/timezone. The original `load`, validation, write dispatch and entire `applyDomainCommand` section remain byte-for-byte unchanged. Individual get-object reads retain their existing behavior.
- `apps/server/src/change-watermark.ts`: checks relation existence before reading household-local `last_committed_change_id`; returns numeric zero if the table/household row is absent, otherwise the decimal string. No sync tables are created. Responses/cursors normalize this to a decimal string, preserving bigint precision per the sync contract.
- `packages/contracts/src/index.ts`: only the three read input schemas changed.
- `migrations/012_query_indexes.sql`: transactional regular indexes, pg_trgm and a separate search normalization function. Existing intake name identity normalization is unchanged.
- `tests/batch2/query-{cursors,database,performance}.test.ts`: pure/stub regression checks, optional actual-DB checks, and opt-in full-scale single-reader measurements.
- This handoff document. No web projection, client, snapshot type, export, sync implementation, registry, profile, deadline, void or other migration changes.

## Read contract decisions

Browse accepts `sort: {field, direction}`. Fields are `created_at`, `updated_at`, `name`, and item-only `reminder_date`; directions are `asc`/`desc`. Default is `created_at DESC`. Every sort appends ID in the same direction, with NULLS LAST. Reminder sorting uses existing lifecycle expiry/opening facts and household timezone; it adds no deadline model or relative-date filters.

`search` and legacy `name` both use the same normalized search predicate; if both are supplied they are combined with AND. Fields are effective item name, SKU name, specification, brand, model, barcodes, item/SKU IDs and item note body. Catalog search uses catalog name/ID and product fields. Normalization is NFKC → root-locale Unicode lower → collapse ECMAScript whitespace → trim. `%`, `_` and backslash are literal search characters. Raw data is unchanged. Location-path text search is omitted; recursive container scoping and returned path IDs remain supported. There is no grouping endpoint added in this lane; matching totals and detail pages share the same SQL matching CTE.

The normalizer explicitly uses `und-x-icu`, available in the repository's deployed `postgres:18-bookworm` image; this avoids database-locale-dependent Unicode casing. Verify the collation/golden samples when using another PostgreSQL build. No package dependency is added. Chinese short terms use ILIKE, with normalized name pg_trgm indexes; no ngram engine is introduced. Product fields/notes have bounded household/relationship scans and no speculative text indexes.

Attribute paths/operators retain their existing validation. Equality predicates get a GIN-compatible containment candidate and exact JSON equality verification. Every predicate for one template shares one `jsonb_array_elements` entry, including date kind and both date bounds. Unknown bindings are preserved on reads without registry lookups; returned bindings receive shape checks. The QUERY07 DB fixture deliberately includes duplicate legacy bindings to distinguish same-entry matching from independent EXISTS predicates; it does not make those bindings legal for writes.

`matching_count` covers all matches. `current_count`, unknown lifecycle/availability, and content totals exclude terminal states but include unknown state. Percent remains a separate count, and decimal quantities are summed only within units. Hidden catalog entries do not remove their items. All legacy top-level summary fields remain; an additive `summary` repeats them with its own current `as_of_change_id`.

Opaque base64url cursors contain version, household, query hash, sort, last key/ID, and initial `as_of_change_id`. They are validated but are not signed credentials; normal actor/household authorization still runs on every request. Invalid encoding/version/key, cross-household, changed conditions and changed sort return `INVALID_CURSOR`. Old offset cursors are invalid. Page size and `include_path` may change during browsing; they do not change membership or the query hash. Other parsed conditions are hashed canonically (filter-array ordering remains significant).

Each request uses the existing REPEATABLE READ READ ONLY transaction. `stale` compares its household watermark with the initial cursor watermark and does not prevent browsing. The page's top-level `as_of_change_id` is the initial browse watermark; `summary.as_of_change_id` is the current request's snapshot watermark. Until sync state exists, all such watermarks are `"0"`, so changes cannot yet be detected. Timestamps in cursor keys preserve PostgreSQL microseconds. Browse can still miss inserts/edits moved before the cursor, as specified.

History accepts `target`, `operation_id`, `event_type`, and inclusive `recorded_from`/`recorded_to` bounds. It uses SQL WHERE, `(recorded_at,id) DESC` keysets and LIMIT. Optional target existence checks do not load/validate the object. Existing target/operation indexes and the new household/time index support the access paths.

Business SQL count is constant: browse 2 statements before sync state exists, 3 afterward (relation probe, optional watermark lookup, combined page/summary query). Including actor authorization, isolation setting, BEGIN and COMMIT: 6/7. Target history adds one existence statement. Notes and path depth do not add network round trips. Matching is materialized inside PostgreSQL to reuse the exact matching set for page and summaries; large matching sets still require server-side aggregation/sorting, to be assessed by EXPLAIN and measurement.

## Commands and local results

The root Vitest config only includes `tests/*.test.ts`. Use a temporary configuration to run the owned nested files without changing that config:

```sh
cat > /tmp/acornary-query-vitest.mjs <<'CONFIG'
export default { test: { include: ['tests/batch2/query-*.test.ts'], fileParallelism: false, testTimeout: 30000, hookTimeout: 30000 } };
CONFIG
../../node_modules/.bin/tsc --noEmit
../../node_modules/.bin/vitest run tests/batch2/query-*.test.ts --config /tmp/acornary-query-vitest.mjs --reporter=dot
../../node_modules/.bin/vitest run tests/domain.test.ts --reporter=dot
```

Local results: TypeScript passed; query tests 10 passed / 20 skipped (9 database checks, 11 opt-in performance cases); existing domain tests 8 passed. Stub checks exercise real read dispatch and assert constant SQL calls but are explicitly not database execution/performance evidence.

## Integrator verification still required

1. Apply migration 012 through the migration lane's runner to an isolated, migrated PostgreSQL 18 database whose URL includes `acornary_test`. Set `DATABASE_URL` and rerun the targeted query tests above. Fixtures append isolated households and do not truncate shared tables. The real stale/watermark test additionally requires the sync lane's `household_sync_state`; it skips that case when absent. It simulates watermark advancement directly, so actual write-hook coverage remains the sync lane's responsibility.
2. QUERY08 small-fixture test captures the actual SQL statement's EXPLAIN ANALYZE/BUFFERS, checks all nine indexes and constant SQL count. Small-fixture plans are not scale/budget evidence. Verify history's actual plan too using the performance cases.
3. Seed the distribution specified in `tests/batch0/benchmark.config.json`: 10k items, 100k events, 10k notes, multiple households and depth-10 containers, with current legal bindings. The existing Batch 0 seed is a reference fixture, not evidence that integrated lane migrations/fixtures pass. Use the integrator's validated seed and retain its hash/distribution.
4. With that database set `BATCH2_QUERY_PERF=1`, `BATCH2_QUERY_HOUSEHOLD` and `BATCH2_QUERY_ACTOR`, then run only `tests/batch2/query-performance.test.ts` with the temporary config. This read-only harness executes 100 warmups and 1,000 samples × 3 rounds per case, prints actual SQL/parameters, EXPLAIN ANALYZE/BUFFERS, SQL counts and raw samples, and checks p95 budgets (items 300ms, history 150ms, search 200ms). Capture stdout externally; it does not write evidence files or seed a database. Confirm that configured search terms have representative nonzero selectivity in the fixture.
5. Separately run five readers/one writer, the 30 process-cold runs (record OS cache policy), and baseline/candidate write throughput on equivalent resources. Retain actual resources, source/fixture hashes, versions, raw samples and plans. The single-reader harness is not a substitute for those remaining benchmark modes. A write regression over 10% is not waived.
6. If two-character Chinese exceeds 200ms p95, retain the failing actual plan and samples. The smallest next proposal is to split search candidate collection by field so existing normalized-name trigram indexes can contribute independently before shared matching/aggregation; assess note/product scan cost from that plan before proposing any further index. No failure or budget compliance can be inferred here without a DB run.

No out-of-ownership implementation blocker was encountered. DB correctness, plans and performance remain unverified locally. QUERY04/05 export are Batch 7; QUERY09 barcode diff-on-save is explicitly left to integration/sync ownership.
