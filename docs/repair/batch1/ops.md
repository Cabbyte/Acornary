# Batch 1 ops delivery

Scope: migration runner, operation identity/integrity, and runtime grants. Only the ops-owned files changed. No service, contract, migration 001–008, Batch 0 case/evidence, or other lane changes. This is local implementation evidence, not production audit or PostgreSQL acceptance evidence.

## Implementation

- `apps/server/src/migrate.ts`: SHA-256 of exact file bytes; preflight drift rejection for known hashes, including failed/interrupted attempts; durable `STARTED`/`APPLIED`/`FAILED`, attempt counter, start/finish timestamps, and JSON-encoded error message/code. Existing ledger rows retain their original `applied_at`, have NULL checksum/transactional, and become `UNVERIFIED`; current file bytes are never presented as historical provenance. The existing filename identifies the step; `checkpoint` is the runbook's durable backfill/index recovery state.
- `apps/server/src/db.ts`: separate one-connection migration pool. The runner explicitly sets statement and idle-in-transaction timeouts to zero before acquiring the session advisory lock (pg omits numeric zero startup parameters). The lock spans all files and backfill commits. Ordinary files and their APPLIED record commit together; `-- acornary:no-transaction` opts out of the file transaction. The CLI, `migrate(grants = false)`, migration ordering, and `--grants` remain available. No 006 is invented.
- Concurrent index recovery accepts one plain-column btree CREATE INDEX CONCURRENTLY statement per file. Creation intent is recorded only after verifying the name is absent. Recovery requires the same migration checksum, recorded index ownership, and exact normalized catalog definition. Only a matching invalid index is dropped; matching valid indexes left by interrupted ledger writes are adopted without rebuilding. Pre-existing unowned or mismatched objects stop the run. There is no global invalid-index sweep.
- `deploy/grants.sql`: explicitly revokes stale UPDATE/DELETE on operations and DELETE on items/catalog_nodes/notes; preserves required inserts/updates and barcode_index DELETE. Existing table grants only. Apply with the existing `--grants` option as the migration role.

The six `009_*.sql` files implement these independently committed steps:

1. Expand the nullable real operation ID; install the BEFORE INSERT compatibility bridge and insert-only size guards. The bridge requires a JSON string containing the existing typed UUID format, fills an omitted/NULL column, and rejects a conflicting explicit column. It never generates an ID.
2. Backfill only `operation_id` in at most 1,000-row primary-key/keyset batches. A top-level nontransactional DO commits each batch and its checkpoint together. The checkpoint retains the initial upper key and last committed key; restarts only fill NULL columns beyond the checkpoint. Invalid historical IDs stop for manual repair. The unchanged application can insert through the already committed bridge during failure/recovery, including keys behind the checkpoint.
3. Build the household/operation unique index concurrently.
4. Attach the unique constraint; add the household-scoped, initially deferred events FK and ID consistency CHECK as NOT VALID.
5. Validate the FK and CHECK in a separate transaction. Existing corrupt/duplicate/orphan history is rejected, never rewritten or fabricated.
6. Set NOT NULL using the validated CHECK and enable operations UPDATE/DELETE immutability. Existing events immutability remains active.

DDL uses a two-second lock timeout where table locks are needed; each backfill batch also has a two-second lock timeout. Failed steps retain previously committed expansion and stop subsequent steps. Retry unchanged files after resolving the underlying data/lock problem; changing a known migration's bytes intentionally fails checksum verification. An interrupted connection may leave STARTED instead of FAILED; the next run uses the durable checkpoint/catalog state.

## Interpretations and limits

- Size means `octet_length(jsonb::text)` in the database encoding (deployment/test databases are UTF-8): changes <= 1,048,576 bytes; result <= 4,194,304 bytes. Compression does not bypass the limit. These are INSERT triggers, so historical oversized receipts/events remain intact and receipt backfill is not blocked by old size. Only the new identity column is updated.
- Legacy UNVERIFIED history is allowed to run as requested. Trusted historical digests/manual sign-off remain an operator responsibility; this change does not invent evidence or a sign-off flag.
- The explicit requested implementation does not define new event source/type enums or changes schemas (S06/S15), nor polymorphic target checks. Existing historical aliases and application behavior are preserved; only the requested new-insert size guards are added here.
- SQL files use six `009_` steps to separate committed expansion/backfill, nontransactional index creation, constraint addition, validation, and immutability. No generic task framework or additional CLI flags were added.
- Recovery coverage simulates interruption with a failing second backfill batch and a durable STARTED index record. Process-kill/network-loss and production-scale timing/load exercises remain integrator checks.

## Local checks (2026-10-31)

- `../../node_modules/.bin/tsc --noEmit`: PASS.
- Requested `../../node_modules/.bin/vitest run tests/batch1/ops-*.test.ts --reporter=dot`: no test files selected because the existing root config includes only `tests/*.test.ts`. That unowned config was not modified. The equivalent targeted invocation below passed: **15 runner tests passed; 11 PostgreSQL tests skipped** because DATABASE_URL was absent.
- `../../node_modules/.bin/vitest run tests/repair-batch0.test.ts --reporter=dot`: **15 passed, 76 existing TODO cases**. Those TODOs are not repair acceptance.
- `git diff --check`: PASS.

Run the targeted tests from this worktree root without changing repository configuration:

```sh
node --input-type=module <<'JS'
import { startVitest } from '../../node_modules/vitest/dist/node.js';
const ctx = await startVitest('test', [], {
  config: false,
  include: ['tests/batch1/ops-*.test.ts'],
  reporters: ['dot'],
  fileParallelism: false,
  testTimeout: 30000,
  hookTimeout: 60000,
});
if (!ctx) process.exitCode = 1;
await ctx?.close();
JS
```

## Integrator PostgreSQL checks

Set DATABASE_URL to an **isolated PostgreSQL 18 UTF-8 test database whose name contains `acornary_test`**, then run the same command. The test account needs CREATEDB and CREATEROLE plus permission to SET ROLE to the temporary runtime role (a local test superuser is sufficient). The suite creates/drops a uniquely named database and runtime role; it does not start a server. Never point it at production. No Docker/Postgres, full-suite, Playwright, or Android run was performed for this delivery.

`tests/batch1/ops-postgres.test.ts` exercises real 001–008 migrations and all six 009 steps, covering:

- OP01: event-before-receipt transaction commits.
- OP02/OP04: missing and cross-household receipts fail specifically at COMMIT; missing-receipt events roll back.
- OP03: household-scoped uniqueness, including the same ID allowed in a second household.
- OP05/OP06/OP07 and OPS03/OPS04: first 1,000-row batch survives a later failure; a second connection inserts via the bridge; retry resumes its checkpoint without replacing new data; original receipt text/fingerprints/formats/timestamps and all historical event JSON compare exactly; oversized historical records survive; final UPDATE/DELETE guards reject mutations.
- OPS01: old ledger records stay UNVERIFIED without fabricated checksums; changed applied files fail drift verification.
- OPS02: real concurrent unique-index failure, selective invalid-index cleanup while an unrelated invalid index survives, successful retry/attempt increment, and valid-index adoption preserving its OID.
- OPS04: ordinary failed DDL rolls back while compatible application receipt writes continue.
- Missing/null/non-string/malformed/mismatched identity rejection; matching explicit and bridged IDs; exact size boundaries and multibyte data.
- Actual stale grants are revoked; runtime receipt insertion, object updates, and barcode deletion still succeed.

PostgreSQL acceptance remains **NOT_RUN** locally. Existing broad integration tests that deliberately UPDATE historical operations will need fixture setup before immutability (outside this lane's ownership); this delivery does not weaken production protections to accommodate those fixtures.
